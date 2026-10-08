import { test } from 'test-anywhere';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import * as api from '../src/index.js';
import {
  getFileUploadInfo,
  isStoredFileName,
  stageUploadFiles,
} from '../src/file-upload.js';

const logger = { log() {}, warn() {}, error() {} };
async function withFile(content, run, name = 'data.bin') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-37-'));
  const filePath = path.join(directory, name);
  fs.writeFileSync(filePath, content);
  try {
    return await run(filePath);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function repositoryStream({ existing = [], failPush = false } = {}) {
  const commands = [];
  const commits = [];
  const bind =
    (options = {}) =>
    (strings, ...values) => {
      if (!Array.isArray(strings?.raw)) {
        return bind(strings);
      }
      const command = strings.reduce(
        (text, part, i) => text + part + (values[i] ?? ''),
        ''
      );
      commands.push(command);
      if (command.startsWith('gh gist create ')) {
        throw new Error('Binary content must never reach gh gist create');
      }
      if (command.startsWith('gh api user ')) {
        return { code: 0, stdout: 'test-user\n' };
      }
      if (command.includes('defaultBranch')) {
        return {
          code: 0,
          stdout: JSON.stringify({
            defaultBranch: 'main',
            visibility: 'private',
          }),
        };
      }
      if (command.includes('/contents/')) {
        return { code: 0, stdout: JSON.stringify(existing) };
      }
      if (command.startsWith('git commit ')) {
        const names = fs
          .readdirSync(options.cwd, { recursive: true })
          .filter(
            (name) =>
              !name.startsWith('.git') &&
              fs.statSync(path.join(options.cwd, name)).isFile()
          );
        commits.push(
          new Map(
            names.map((name) => [
              name.split(path.sep).join('/'),
              fs.readFileSync(path.join(options.cwd, name)),
            ])
          )
        );
      }
      if (command.startsWith('git push ') && failPush) {
        return { code: 1, stderr: 'Permission denied (HTTP 403)' };
      }
      return {
        code: command === 'git diff --cached --quiet' ? 1 : 0,
        stdout: '',
      };
    };
  return { stream: bind(), commands, commits };
}

async function uploadBinary(
  filePath,
  options = {},
  state = {},
  direct = false
) {
  const mock = repositoryStream(state);
  const result = await (direct ? api.uploadAsRepo : api.uploadLog)({
    filePath,
    logger,
    ...options,
    commandStreamFactory: () => mock.stream,
  });
  if (result.workDir) {
    fs.rmSync(result.workDir, { recursive: true, force: true });
  }
  return { result, ...mock };
}

test('issue #37 - a small binary file selects an archive in repository mode', async () => {
  await withFile(Buffer.from([0, 255, 128, 10]), async (filePath) => {
    const strategy = api.determineUploadStrategy(filePath);
    assert.equal(strategy.type, 'repo');
    assert.equal(strategy.fileType, 'binary');
    assert.equal(strategy.archiveFormat, 'gzip');
    const result = await api.uploadLog({ filePath, dryMode: true, logger });
    assert.equal(result.type, 'repo');
    assert.equal(result.fileName, 'data.bin.gz');
    assert.equal(result.archiveFormat, 'gzip');
  });
});

test('issue #37 - binary gist requests fail before running GitHub commands, including dry mode', async () => {
  await withFile(Buffer.from([0, 255]), async (filePath) => {
    for (const upload of [
      api.uploadAsGist,
      (options) => api.uploadLog({ ...options, onlyGist: true }),
      (options) => api.uploadLog({ ...options, onlyGist: true, dryMode: true }),
    ]) {
      await assert.rejects(
        upload({
          filePath,
          logger,
          commandStreamFactory: () => {
            throw new Error('No GitHub command should run');
          },
        }),
        /binary.*repository/i
      );
    }
  });
});

test('issue #37 - binary upload archives all bytes and exposes archive metadata', async () => {
  const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  await withFile(bytes, async (filePath) => {
    const { result, commits, commands } = await uploadBinary(filePath);
    assert.equal(result.fileName, 'data.bin.gz');
    assert.equal(result.fileCount, 1);
    assert.equal(result.archiveFormat, 'gzip');
    assert.equal(result.originalFileName, 'data.bin');
    const archive = commits.at(-1).get(`${result.repositoryPath}/data.bin.gz`);
    assert.ok(
      archive,
      'Repository contains a gzip archive rather than log text'
    );
    assert.deepEqual(gunzipSync(archive), bytes);
    assert.ok(!commands.some((c) => c.startsWith('gh gist create ')));
  });
});

test('issue #37 - archive overhead counts toward chunk limits and parts reconstruct exactly', async () => {
  const bytes = Buffer.from([0, 255, 128, 1]);
  await withFile(bytes, async (filePath) => {
    const { result, commits } = await uploadBinary(
      filePath,
      { chunkSize: 8 },
      {},
      true
    );
    assert.ok(
      result.fileCount > 1,
      'Compressed header/trailer also count toward the limit'
    );
    const files = [...commits.at(-1)]
      .filter(([name]) =>
        path.posix.basename(name).startsWith('data.bin.gz.part-')
      )
      .sort(([a], [b]) => a.localeCompare(b));
    assert.equal(files.length, result.fileCount);
    assert.ok(files.every(([, content]) => content.length <= 8));
    assert.deepEqual(
      gunzipSync(Buffer.concat(files.map(([, content]) => content))),
      bytes
    );
    assert.ok(
      [...commits.at(-1).keys()].some((name) =>
        name.endsWith('.data.bin.gz.complete')
      )
    );
  });
});

test('issue #37 - identical archived files deduplicate and partial archives remain resumable', async () => {
  await withFile(Buffer.from([0, 255, 128, 1]), async (filePath) => {
    const complete = await uploadBinary(
      filePath,
      {},
      {
        existing: [
          {
            name: 'data.bin.gz',
            download_url: 'https://example.com/data.bin.gz',
          },
        ],
      }
    );
    assert.equal(complete.result.deduplicated, true);
    assert.equal(complete.result.rawUrl, 'https://example.com/data.bin.gz');
    assert.equal(
      complete.commands.filter((c) => c.startsWith('git ')).length,
      0
    );
    const partial = await uploadBinary(
      filePath,
      { chunkSize: 8 },
      { existing: [{ name: 'data.bin.gz.part-00', size: 4 }] }
    );
    assert.equal(
      partial.result.deduplicated,
      false,
      'Original size cannot prove that a partial gzip archive is complete'
    );
  });
});

test('issue #37 - UTF-8 and ANSI text keep existing gist and line-splitting behavior', async () => {
  await withFile(
    '\u001b[31mError é🙂\u001b[0m\r\nnext',
    async (filePath) => {
      const strategy = api.determineUploadStrategy(filePath);
      assert.equal(strategy.type, 'gist');
      assert.equal(strategy.fileType, 'text');
      const result = await api.uploadLog({
        filePath,
        onlyRepository: true,
        dryMode: true,
        logger,
      });
      assert.equal(result.fileName, 'session.log.txt');
      assert.equal(result.archiveFormat, null);
      assert.equal(typeof api.uploadFile, 'function');
      assert.equal(api.uploadFile, api.uploadLog);
    },
    'session.log'
  );
});

test('issue #37 - classification checks bytes beyond the first buffer and honors UTF-8 boundaries', async () => {
  await withFile(
    Buffer.concat([Buffer.alloc(65535, 97), Buffer.from('🙂\n')]),
    async (filePath) => {
      assert.equal(api.determineUploadStrategy(filePath).type, 'gist');
      fs.appendFileSync(filePath, Buffer.from([255]));
      assert.equal(api.determineUploadStrategy(filePath).type, 'repo');
    }
  );
});

test('issue #37 - dedicated repositories also archive binary files', async () => {
  const bytes = Buffer.from([0, 255, 128]);
  await withFile(bytes, async (filePath) => {
    const { result, commits } = await uploadBinary(filePath, {
      useSharedRepository: false,
    });
    assert.equal(result.archiveFormat, 'gzip');
    assert.equal(result.fileCount, 1);
    assert.deepEqual(
      gunzipSync(commits.at(-1).get(`${result.repositoryPath}/data.bin.gz`)),
      bytes
    );
  });
});

test('issue #37 - hundreds of archive parts sort correctly and repeated staging is deterministic', async () => {
  const bytes = randomBytes(1024);
  bytes[0] = 0;
  await withFile(bytes, async (filePath) => {
    const directory = path.dirname(filePath);
    const outputs = [];
    for (const name of ['first', 'second']) {
      const outputDir = path.join(directory, name);
      const parts = await stageUploadFiles(filePath, outputDir, 4);
      assert.ok(parts.length > 100);
      assert.deepEqual(parts.slice().sort(), parts);
      assert.ok(
        parts.every((part) => fs.statSync(path.join(outputDir, part)).size <= 4)
      );
      outputs.push(
        Buffer.concat(
          parts.map((part) => fs.readFileSync(path.join(outputDir, part)))
        )
      );
    }
    assert.deepEqual(outputs[0], outputs[1]);
    assert.deepEqual(gunzipSync(outputs[0]), bytes);
  });
});

test('issue #37 - hidden text and binary names remain visible upload files', async () => {
  for (const [content, name, fileType] of [
    [Buffer.from([0, 255]), '.binary', 'binary'],
    ['one\ntwo\n', '.text', 'text'],
  ]) {
    await withFile(
      content,
      async (filePath) => {
        const { result } = await uploadBinary(filePath);
        assert.equal(result.fileType, fileType);
        assert.ok(result.fileName.startsWith('file-'));
        const { result: chunked } = await uploadBinary(filePath, {
          chunkSize: 4,
        });
        assert.ok(chunked.fileCount > 1);
      },
      name
    );
  }
});

test('issue #37 - empty text, UTF-16 and truncated UTF-8 classify without losing bytes', async () => {
  for (const [bytes, expected] of [
    [Buffer.alloc(0), 'text'],
    [Buffer.from('hi', 'utf16le'), 'binary'],
    [Buffer.from([0xf0, 0x9f]), 'binary'],
  ]) {
    await withFile(bytes, async (filePath) =>
      assert.equal(api.detectFileType(filePath), expected)
    );
  }
});

test('issue #37 - long text chunk names match the shortened upload name', async () => {
  await withFile(
    'one\ntwo\nend\n',
    async (filePath) => {
      const info = getFileUploadInfo(filePath);
      const outputDir = path.join(path.dirname(filePath), 'parts');
      const parts = await stageUploadFiles(filePath, outputDir, 4, info);
      assert.ok(parts.every((name) => isStoredFileName(name, info)));
      assert.ok(parts.every((name) => name.length <= 255));
      assert.equal(
        parts
          .map((name) => fs.readFileSync(path.join(outputDir, name), 'utf8'))
          .join(''),
        'one\ntwo\nend\n'
      );
    },
    `${'a'.repeat(230)}.txt`
  );
});

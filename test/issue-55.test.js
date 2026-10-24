import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { withSanitizedUpload } from '../src/sanitization.js';
import {
  uploadLog,
  uploadFile,
  uploadAsGist,
  uploadAsRepo,
  generateFileContentHash,
  buildLogRepositoryPath,
} from '../src/index.js';

const logger = { log() {}, warn() {}, error() {} };
const credential = 'test-fixture-credential-only';
const original = `Account: github.com/konard user@example.org ID 123456789\r\npassword=${credential}\r\nKeep all other content.\n`;
const expected = original.replace(credential, '[REDACTED]');

async function withFile(content, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-55-'));
  const filePath = path.join(dir, 'session.log');
  fs.writeFileSync(filePath, content);
  try {
    await run(filePath, dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function captureCommands({ failGist = false } = {}) {
  const commands = [];
  const payloads = [];
  const stagedPaths = [];
  const bind =
    () =>
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
        stagedPaths.push(values[0]);
        payloads.push(fs.readFileSync(values[0]));
        return failGist
          ? { code: 1, stdout: '', stderr: 'gist disabled' }
          : { code: 0, stdout: 'https://gist.github.com/test/123', stderr: '' };
      }
      if (command.includes('gh api gists/')) {
        return { code: 0, stdout: '[]' };
      }
      if (command.startsWith('gh api user ')) {
        return { code: 0, stdout: 'test-user' };
      }
      if (command.includes('defaultBranch')) {
        return {
          code: 0,
          stdout: '{"defaultBranch":"main","visibility":"public"}',
        };
      }
      if (command.includes('/contents/')) {
        return { code: 0, stdout: '[]' };
      }
      if (command.startsWith('git diff ')) {
        return { code: 1, stdout: '' };
      }
      return {
        code: 0,
        stdout: command.startsWith('gh repo create ')
          ? 'https://github.com/test-user/test'
          : '',
        stderr: '',
      };
    };
  return { commands, payloads, stagedPaths, factory: () => bind() };
}

test('missing input cannot enter the verified-upload callback', async () => {
  let called = false;
  await assert.rejects(
    withSanitizedUpload({}, () => {
      called = true;
      return {};
    }),
    /filePath is required/
  );
  assert.equal(called, false);
});

test('symbolic-link inputs retain their name and sanitize the target', async () => {
  await withFile(original, async (filePath, dir) => {
    const linkedPath = path.join(dir, 'linked.log');
    fs.symlinkSync(filePath, linkedPath, 'file');
    const capture = captureCommands();
    const result = await uploadAsGist({
      filePath: linkedPath,
      commandStreamFactory: capture.factory,
      logger,
    });
    assert.equal(capture.payloads[0].toString(), expected);
    assert.equal(fs.readFileSync(filePath, 'utf8'), original);
    assert.ok(result.fileName.endsWith('-linked.log.txt'), result.fileName);
    assert.equal(result.sanitization.redactions, 1);
  });
});

for (const isPublic of [false, true]) {
  test(`every gist entry point sanitizes (${isPublic ? 'public' : 'private'})`, async () => {
    await withFile(original, async (filePath) => {
      for (const upload of [uploadLog, uploadFile, uploadAsGist]) {
        const capture = captureCommands();
        const result = await upload({
          filePath,
          isPublic,
          commandStreamFactory: capture.factory,
          logger,
        });
        assert.equal(capture.payloads[0].toString(), expected);
        assert.equal(fs.readFileSync(filePath, 'utf8'), original);
        assert.ok(
          capture.stagedPaths.every((staged) => !fs.existsSync(staged))
        );
        assert.equal(result.sanitization.redactions, 1);
        assert.ok(
          Object.values(result.sanitization.rules).some((count) => count > 0)
        );
      }
    });
  }, 30000);
}

for (const mode of ['shared', 'dedicated', 'existing', 'fallback']) {
  test(`sanitizes repository ${mode} before hashing, splitting or compression`, async () => {
    // Invalid UTF-8 and NUL select gzip, while all noncredential bytes survive.
    const bytes = Buffer.concat([
      Buffer.from([0xff, 0, 0xc3, 0x28]),
      Buffer.from(original),
    ]);
    await withFile(bytes, async (filePath) => {
      const capture = captureCommands({ failGist: mode === 'fallback' });
      if (mode === 'fallback') {
        fs.writeFileSync(filePath, original);
      }
      const result = await (mode === 'fallback' ? uploadLog : uploadAsRepo)({
        filePath,
        isPublic: true,
        chunkSize: 48,
        useSharedRepository: mode !== 'dedicated',
        ...(mode === 'existing'
          ? { repository: 'test-user/logs', branch: 'logs' }
          : {}),
        logger,
        commandStreamFactory: capture.factory,
      });
      try {
        const output = path.join(result.workDir, result.repositoryPath);
        const parts = fs
          .readdirSync(output)
          .filter((name) => !name.startsWith('.'))
          .sort();
        const stored = Buffer.concat(
          parts.map((name) => fs.readFileSync(path.join(output, name)))
        );
        const safe = mode === 'fallback' ? stored : gunzipSync(stored);
        const expectedBytes =
          mode === 'fallback'
            ? Buffer.from(expected)
            : Buffer.concat([bytes.subarray(0, 4), Buffer.from(expected)]);
        assert.deepEqual(safe, expectedBytes);
        const expectedPath = `${filePath}.safe`;
        fs.writeFileSync(expectedPath, expectedBytes);
        const hash = await generateFileContentHash(expectedPath);
        assert.equal(result.contentHash, hash);
        assert.equal(
          result.repositoryPath,
          buildLogRepositoryPath(filePath, hash)
        );
        assert.equal(result.sanitization.redactions, 1);
      } finally {
        fs.rmSync(result.workDir, { recursive: true, force: true });
      }
    });
  }, 30000);
}

test('sanitization failure blocks every network operation and explains why', async () => {
  await withFile(original, async (filePath, dir) => {
    const previous = process.env.GH_CONFIG_DIR;
    process.env.GH_CONFIG_DIR = dir;
    fs.writeFileSync(path.join(dir, 'hosts.yml'), 'bad: [unclosed');
    try {
      for (const upload of [uploadLog, uploadAsGist, uploadAsRepo]) {
        const capture = captureCommands();
        await assert.rejects(
          upload({
            filePath,
            isPublic: true,
            logger,
            commandStreamFactory: capture.factory,
          }),
          /Sanitization failed.*ERR_AUTH/
        );
        assert.deepEqual(capture.commands, []);
      }
      const cli = spawnSync(
        'node',
        ['src/cli.js', filePath, '--public', '--dry'],
        { encoding: 'utf8', timeout: 30000 }
      );
      assert.equal(cli.status, 1);
      assert.match(cli.stderr, /Sanitization failed.*ERR_AUTH/);
      assert.match(cli.stderr, /nothing was uploaded/);
      assert.ok(!`${cli.stdout}${cli.stderr}`.includes(credential));
    } finally {
      if (previous === undefined) {
        delete process.env.GH_CONFIG_DIR;
      } else {
        process.env.GH_CONFIG_DIR = previous;
      }
    }
  });
}, 60000);

test('environment credentials are masked and dry mode hashes the verified copy', async () => {
  const name = 'ISSUE_55_SERVICE_TOKEN';
  const previous = process.env[name];
  process.env[name] = credential;
  try {
    await withFile(`Value ${credential}\n`, async (filePath, dir) => {
      const result = await uploadLog({
        filePath,
        onlyRepository: true,
        dryMode: true,
        logger,
      });
      const safe = path.join(dir, 'safe');
      fs.writeFileSync(safe, 'Value [REDACTED]\n');
      assert.equal(result.contentHash, await generateFileContentHash(safe));
      assert.ok(result.sanitization.rules['known-secret'] > 0);
    });
  } finally {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  }
});

test('local credential config is masked and later source changes cannot affect the verified snapshot', async () => {
  await withFile(`Credential ${credential}\n`, async (filePath, dir) => {
    const previous = process.env.GH_CONFIG_DIR;
    process.env.GH_CONFIG_DIR = dir;
    fs.writeFileSync(
      path.join(dir, 'hosts.yml'),
      `github.com:\n  users:\n    fixture:\n      oauth_token: ${credential}\n`
    );
    let staged;
    try {
      const result = await withSanitizedUpload(
        { filePath },
        async (options) => {
          staged = options.filePath;
          fs.writeFileSync(filePath, 'password=new-raw-credential');
          assert.equal(
            fs.readFileSync(staged, 'utf8'),
            'Credential [REDACTED]\n'
          );
          throw new Error('mock downstream upload failure');
        }
      ).catch((error) => error);
      assert.match(result.message, /mock downstream upload failure/);
      assert.equal(fs.existsSync(staged), false);
    } finally {
      if (previous === undefined) {
        delete process.env.GH_CONFIG_DIR;
      } else {
        process.env.GH_CONFIG_DIR = previous;
      }
    }
  });
});

test('CLI reports credential counts by rule and zero findings', async () => {
  await withFile(original, async (filePath) => {
    for (const content of [original, 'Ordinary complete log\n']) {
      fs.writeFileSync(filePath, content);
      const result = spawnSync(
        'node',
        ['src/cli.js', filePath, '--public', '--dry'],
        { encoding: 'utf8', timeout: 30000 }
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(
        result.stdout,
        new RegExp(
          `Sanitization: ${content === original ? 1 : 0} credential span`
        )
      );
      if (content === original) {
        assert.match(result.stdout, /context: 1/);
      }
      assert.ok(!result.stdout.includes(credential));
    }
  });
}, 60000);

test('streams a 17 MiB log with a 15 MiB line and checks every output byte', () => {
  const scenario = fileURLToPath(
    new URL('../experiments/issue-55-streaming.mjs', import.meta.url)
  );
  const result = spawnSync(
    'node',
    ['--max-old-space-size=640', scenario, '--quick'],
    { encoding: 'utf8', timeout: 60000 }
  );
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
}, 75000);

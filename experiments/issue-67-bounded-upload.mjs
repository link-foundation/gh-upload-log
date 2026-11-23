// Offline upload with a scratch payload budget and an interrupted push.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, URL } from 'node:url';
import { createLocalRepositoryStream } from './issue-45-local-git.mjs';
import { createExistingRepositoryStream } from './issue-47-local-git.mjs';

const checkout = process.env.ISSUE_67_CHECKOUT
  ? pathToFileURL(path.resolve(process.env.ISSUE_67_CHECKOUT, 'src/index.js'))
  : new URL('../src/index.js', import.meta.url);
const { uploadLog } = await import(checkout.href);
const mode = process.argv[2] || 'shared';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-67-remote-'));
// Keep large source bytes and the fake server out of the client scratch scope.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-67-scratch-'));
process.env.TMPDIR = scratch;
process.env.TEMP = scratch;
process.env.TMP = scratch;

const filePath = path.join(root, 'session.log');
const chunkSize = 8191;
const credential = ['synthetic', 'private', 'credential', 'A1234'].join('-');
const content = `first line\r\npassword=${credential}\r\n${'🌲é'.repeat(4000)}final 🌍`;
fs.writeFileSync(filePath, content);
const branch = mode === 'target' ? 'feature/logs' : 'main';
const indexName = '.session.log.txt.index.json';
let failAt = mode === 'changed' ? -1 : mode === 'dedicated' ? 2 : 3;
let createdRepository;
let changedSource = false;

try {
  const makeRemote =
    mode === 'target'
      ? createExistingRepositoryStream
      : createLocalRepositoryStream;
  const local = makeRemote(root, {
    empty: mode === 'dedicated',
    onPush({ attempt, runGit, remote, workDir }) {
      assert.deepEqual(
        fs.readdirSync(scratch),
        [path.basename(workDir)],
        'client scratch must contain only the metadata repository'
      );
      assert.deepEqual(
        fs.readdirSync(workDir),
        ['.git'],
        'upload must not materialize a working tree'
      );
      const blobs = runGit(
        [
          'cat-file',
          '--batch-all-objects',
          '--batch-check=%(objecttype) %(objectsize)',
        ],
        workDir
      )
        .split('\n')
        .filter((line) => line.startsWith('blob '))
        .map((line) => Number(line.slice(5)));
      assert.ok(
        blobs.reduce((sum, bytes) => sum + bytes, 0) <= chunkSize + 512,
        `scratch blob budget exceeded with ${blobs.join(', ')} bytes`
      );
      if (mode !== 'dedicated' || attempt > 1) {
        assert.ok(
          !runGit([
            '--git-dir',
            remote,
            'ls-tree',
            '-r',
            '--name-only',
            branch,
          ]).includes(indexName),
          'index is visible before all parts are pushed'
        );
      }
      if (mode === 'changed' && attempt === 1) {
        changedSource = true;
        const fd = fs.openSync(filePath, 'r+');
        try {
          // Change a byte inside a later part without changing source size.
          fs.writeSync(fd, 'X', Buffer.byteLength(content) - 10);
        } finally {
          fs.closeSync(fd);
        }
      }
      return attempt === failAt
        ? { code: 1, stderr: 'RPC failed; HTTP 408' }
        : null;
    },
  });
  const bind =
    (configuration = {}) =>
    (strings, ...values) => {
      if (!Array.isArray(strings?.raw)) {
        return bind(strings);
      }
      if (mode === 'dedicated') {
        if (strings[0].startsWith('gh repo create ')) {
          createdRepository = { name: values[0], description: values[2] };
          return { code: 0 };
        }
        if (strings[0] === 'gh api repos/' && strings[2] === ' --jq ') {
          return createdRepository?.name === values[1]
            ? {
                code: 0,
                stdout: JSON.stringify({
                  defaultBranch: branch,
                  visibility: 'private',
                  description: createdRepository.description,
                }),
              }
            : { code: 1, stderr: 'Not Found (HTTP 404)' };
        }
      }
      return local.stream(configuration)(strings, ...values);
    };
  const options = {
    filePath,
    // Exercise default auto selection for a text file above its Gist limit.
    gistFileLimit: 4096,
    useSharedRepository: mode !== 'dedicated',
    ...(mode === 'target'
      ? { repository: 'example-org/current-repo', branch }
      : {}),
    chunkSize,
    logger: { log() {}, warn() {}, error() {} },
    commandStreamFactory: () => bind(),
    pushRetries: 0,
  };
  const listing = () =>
    local.runGit([
      '--git-dir',
      local.remote,
      'ls-tree',
      '-r',
      '--name-only',
      branch,
    ]);
  if (mode === 'changed') {
    await assert.rejects(uploadLog(options), { code: 'ERR_INPUT_CHANGED' });
    assert.equal(changedSource, true);
    assert.ok(!listing().includes(indexName));
  } else {
    await assert.rejects(uploadLog(options), /HTTP 408/);
    assert.ok(listing().includes('.session.log.txt.pending'));
    assert.ok(!listing().includes(indexName));
    assert.deepEqual(fs.readdirSync(scratch), []);

    const confirmed = local.pushes.length;
    failAt = -1;
    const result = await uploadLog(options);
    assert.equal(result.fileCount + 1, local.pushes.length);
    assert.equal(confirmed, mode === 'dedicated' ? 1 : 2);
    assert.equal(result.sanitization.redactions, 1);
    assert.ok(result.indexUrl.endsWith(indexName));
    const read = (name) =>
      local.runGit([
        '--git-dir',
        local.remote,
        'show',
        `${branch}:${result.repositoryPath}/${name}`,
      ]);
    const index = JSON.parse(read(indexName));
    const { prefix, suffix, digits, count } = index.parts;
    assert.equal(count, result.fileCount);
    const parts = Array.from({ length: count }, (_, i) =>
      read(`${prefix}${String(i).padStart(digits, '0')}${suffix}`)
    );
    for (const part of parts) {
      assert.ok(Buffer.byteLength(part) <= chunkSize);
      assert.ok(!part.includes('�'));
    }
    const output = parts.join('');
    assert.equal(output, content.replace(credential, '[REDACTED]'));
    assert.equal(index.bytes, Buffer.byteLength(output));
    assert.equal(
      index.sha256,
      createHash('sha256').update(output).digest('hex')
    );
    assert.ok(!listing().includes('.session.log.txt.pending'));
    assert.ok(!local.pushes.at(-1).some((name) => name.includes('.part-')));
    assert.equal((await uploadLog(options)).deduplicated, true);
    assert.equal(result.fileCount + 1, local.pushes.length);
  }
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
}

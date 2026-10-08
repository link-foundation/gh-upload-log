// Offline binary upload, interruption, changed chunk size, deduplication and selected-branch probe.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { uploadFile } from '../src/index.js';
import { createExistingRepositoryStream } from './issue-47-local-git.mjs';
import { GIT_COMMAND_TIMEOUT_MS } from './real-git-test-utils.mjs';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-37-git-'));
const filePath = path.join(directory, 'data.bin');
const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
fs.writeFileSync(filePath, bytes);
let interrupt = true;
let result;
try {
  const local = createExistingRepositoryStream(directory, {
    onPush: ({ attempt }) =>
      interrupt && attempt === 2
        ? { code: 1, stderr: 'Permission denied (HTTP 403)' }
        : null,
  });
  const mainBefore = local.runGit([
    '--git-dir',
    local.remote,
    'rev-parse',
    'main',
  ]);
  const options = {
    filePath,
    repository: 'example-org/current-repo',
    branch: 'feature/logs',
    chunkSize: 64,
    logger: { log() {}, warn() {}, error() {} },
    pushRetryDelayMs: 0,
    commandStreamFactory: () => local.stream,
  };
  await assert.rejects(uploadFile(options), /Permission denied/);
  assert.equal(local.pushes.length, 1);
  interrupt = false;
  result = await uploadFile({ ...options, chunkSize: 96 });
  assert.equal(result.deduplicated, false);
  const names = local
    .runGit([
      '--git-dir',
      local.remote,
      'ls-tree',
      '-r',
      '--name-only',
      'feature/logs',
      `${result.repositoryPath}/`,
    ])
    .trim()
    .split('\n');
  const parts = names
    .filter((name) => path.posix.basename(name).startsWith('data.bin.gz.part-'))
    .sort();
  assert.equal(parts.length, result.fileCount);
  const archive = Buffer.concat(
    parts.map((name) => {
      const response = spawnSync(
        'git',
        ['--git-dir', local.remote, 'show', `feature/logs:${name}`],
        { timeout: GIT_COMMAND_TIMEOUT_MS }
      );
      assert.equal(response.error, undefined);
      assert.equal(response.status, 0, response.stderr.toString());
      assert.ok(response.stdout.length <= 96);
      return response.stdout;
    })
  );
  assert.deepEqual(gunzipSync(archive), bytes);
  assert.ok(names.some((name) => name.endsWith('.data.bin.gz.complete')));
  assert.ok(!names.some((name) => name.endsWith('.pending')));
  assert.equal(
    local.runGit(['--git-dir', local.remote, 'rev-parse', 'main']),
    mainBefore
  );
  assert.equal(
    local.runGit(['--git-dir', local.remote, 'show', 'feature/logs:seed.txt']),
    'seed\n'
  );
  const pushes = local.pushes.length;
  assert.equal((await uploadFile(options)).deduplicated, true);
  assert.equal(local.pushes.length, pushes);
  assert.ok(
    !local.commands.some((command) => command.startsWith('gh gist create '))
  );
  console.log(
    'Binary Git interruption/resume, reconstruction, branch preservation and deduplication passed.'
  );
} finally {
  if (result?.workDir) {
    fs.rmSync(result.workDir, { recursive: true, force: true });
  }
  fs.rmSync(directory, { recursive: true, force: true });
}

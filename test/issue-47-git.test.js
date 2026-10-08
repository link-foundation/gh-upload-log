import { testWithTimeout as test } from '../experiments/real-git-test-utils.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { uploadLog } from '../src/index.js';
import { createExistingRepositoryStream } from '../experiments/issue-47-local-git.mjs';

const logger = { log() {}, warn() {}, error() {} };

test('issue #47 - real Git fallback writes only selected branch, preserves files and deduplicates', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-47-git-'));
  const filePath = path.join(directory, 'session.log');
  fs.writeFileSync(filePath, 'one\ntwo\ntri\nend\n');
  const local = createExistingRepositoryStream(directory);
  const mainBefore = local
    .runGit(['--git-dir', local.remote, 'rev-parse', 'main'])
    .trim();
  const options = {
    filePath,
    repository: 'example-org/current-repo',
    branch: 'feature/logs',
    chunkSize: 8,
    logger,
    pushRetryDelayMs: 0,
    commandStreamFactory: () => local.stream,
  };
  let result;
  try {
    result = await uploadLog(options);
    assert.equal(result.isPublic, false);
    assert.equal(result.fileCount, 2);
    assert.equal(local.pushes.length, 2);
    assert.equal(
      local.runGit(['--git-dir', local.remote, 'rev-parse', 'main']).trim(),
      mainBefore
    );
    assert.equal(
      local.runGit([
        '--git-dir',
        local.remote,
        'show',
        'feature/logs:seed.txt',
      ]),
      'seed\n'
    );
    const remoteFiles = local
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
      .split('\n')
      .filter((name) => !path.posix.basename(name).startsWith('.'))
      .sort();
    assert.equal(remoteFiles.length, 2);
    assert.equal(
      remoteFiles
        .map((name) =>
          local.runGit([
            '--git-dir',
            local.remote,
            'show',
            `feature/logs:${name}`,
          ])
        )
        .join(''),
      fs.readFileSync(filePath, 'utf8')
    );
    assert.equal(
      local.runGit(['config', '--local', 'user.name'], result.workDir).trim(),
      'gh-upload-log'
    );
    assert.equal(
      local.runGit(['config', '--local', 'user.email'], result.workDir).trim(),
      'gh-upload-log@users.noreply.github.com'
    );
    assert.equal(
      local
        .runGit(
          [
            'config',
            '--local',
            '--get-all',
            'credential.https://github.com.helper',
          ],
          result.workDir
        )
        .trim(),
      '!gh auth git-credential'
    );
    const again = await uploadLog(options);
    assert.equal(again.deduplicated, true);
    assert.equal(local.pushes.length, 2);
    assert.ok(
      !local.commands.some(
        (command) =>
          command.startsWith('gh api user ') ||
          command.startsWith('gh repo create ')
      )
    );
  } finally {
    if (result?.workDir) {
      fs.rmSync(result.workDir, { recursive: true, force: true });
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('issue #47 - real Git retry refreshes the selected branch and preserves concurrent changes', async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'issue-47-git-retry-')
  );
  const filePath = path.join(directory, 'session.log');
  fs.writeFileSync(filePath, 'diagnostic\n');
  const local = createExistingRepositoryStream(directory, {
    onPush: ({ attempt, runGit, writer }) => {
      if (attempt !== 1) {
        return null;
      }
      fs.writeFileSync(path.join(writer, 'concurrent.txt'), 'another writer\n');
      runGit(['add', '--', 'concurrent.txt'], writer);
      runGit(['commit', '-q', '-m', 'Concurrent change'], writer);
      runGit(['push', '-q', 'origin', 'feature/logs'], writer);
      return {
        code: 1,
        stderr: '! [rejected] feature/logs -> feature/logs (fetch first)',
      };
    },
  });
  let result;
  try {
    result = await uploadLog({
      filePath,
      repository: 'example-org/current-repo',
      branch: 'feature/logs',
      onlyRepository: true,
      logger,
      pushRetryDelayMs: 0,
      commandStreamFactory: () => local.stream,
    });
    assert.equal(
      local.commands.filter(
        (command) => command === 'git push -q -u origin refs/heads/feature/logs'
      ).length,
      2
    );
    assert.ok(
      local.commands.includes(
        'git fetch -q --filter=blob:none origin refs/heads/feature/logs'
      )
    );
    assert.equal(
      local.runGit([
        '--git-dir',
        local.remote,
        'show',
        'feature/logs:concurrent.txt',
      ]),
      'another writer\n'
    );
    assert.equal(
      local.runGit([
        '--git-dir',
        local.remote,
        'show',
        `feature/logs:${result.repositoryPath}/session.log.txt`,
      ]),
      'diagnostic\n'
    );
  } finally {
    if (result?.workDir) {
      fs.rmSync(result.workDir, { recursive: true, force: true });
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

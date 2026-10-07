// Run offline Git integration scenarios in isolated Node workers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { uploadLog } from '../src/index.js';

const quietLogger = { log() {}, warn() {}, error() {} };
async function withLog(content, run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-45-worker-'));
  const filePath = path.join(directory, 'session.log');
  fs.writeFileSync(filePath, content);
  try {
    return await run(filePath, directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const scenarios = {
  0: async () => {
    const { createLocalRepositoryStream } =
      await import('../experiments/issue-45-local-git.mjs');
    await withLog('one\ntwo\ntri\nend\n', async (filePath, directory) => {
      const repository = createLocalRepositoryStream(directory, {
        onPush: ({ attempt, runGit, writer }) => {
          if (attempt === 1) {
            fs.writeFileSync(
              path.join(writer, 'concurrent.txt'),
              'another upload\n'
            );
            runGit(['add', '.'], writer);
            runGit(['commit', '-q', '-m', 'Concurrent upload'], writer);
            runGit(['push', '-q', 'origin', 'main'], writer);
          }
          return null;
        },
      });
      const result = await uploadLog({
        filePath,
        onlyRepository: true,
        chunkSize: 8,
        pushRetryDelayMs: 0,
        logger: quietLogger,
        commandStreamFactory: () => repository.stream,
      });
      try {
        assert.equal(repository.attempts, 3);
        assert.equal(result.fileCount, 2);
        assert.equal(
          repository.runGit([
            '--git-dir',
            repository.remote,
            'show',
            'main:concurrent.txt',
          ]),
          'another upload\n'
        );
        const parts = ['00', '01'].map((index) =>
          repository.runGit([
            '--git-dir',
            repository.remote,
            'show',
            `main:${result.repositoryPath}/session.part-${index}.log.txt`,
          ])
        );
        assert.equal(parts.join(''), fs.readFileSync(filePath, 'utf8'));
        assert.ok(
          repository.pushes.every(
            (files) =>
              files.filter((name) => name.endsWith('.log.txt')).length === 1
          )
        );
      } finally {
        fs.rmSync(result.workDir, { recursive: true, force: true });
      }
    });
  },
  1: async () => {
    const { createLocalRepositoryStream } =
      await import('../experiments/issue-45-local-git.mjs');
    await withLog('one\ntwo\ntri\nend\n', async (filePath, directory) => {
      let fail = true;
      const repository = createLocalRepositoryStream(directory, {
        onPush: ({ attempt }) =>
          fail && attempt > 1
            ? { code: 1, stderr: 'RPC failed; HTTP 408' }
            : null,
      });
      const options = {
        filePath,
        onlyRepository: true,
        chunkSize: 8,
        pushRetryDelayMs: 0,
        logger: quietLogger,
        commandStreamFactory: () => repository.stream,
      };
      await assert.rejects(uploadLog(options), /HTTP 408/);
      assert.equal(
        repository
          .runGit([
            '--git-dir',
            repository.remote,
            'rev-list',
            '--count',
            'main',
          ])
          .trim(),
        '2'
      );
      fail = false;
      const result = await uploadLog(options);
      try {
        assert.equal(
          repository
            .runGit([
              '--git-dir',
              repository.remote,
              'rev-list',
              '--count',
              'main',
            ])
            .trim(),
          '3'
        );
        assert.equal(repository.attempts, 5);
        assert.equal(repository.pushes.length, 2);
        assert.ok(
          repository.pushes[1].some((name) => name.endsWith('part-01.log.txt'))
        );
        assert.ok(
          repository.pushes[1].some((name) => name.endsWith('.complete'))
        );
      } finally {
        fs.rmSync(result.workDir, { recursive: true, force: true });
      }
    });
  },
  2: async () => {
    const { createLocalRepositoryStream } =
      await import('../experiments/issue-45-local-git.mjs');
    for (const race of [false, true]) {
      await withLog('tiny log\n', async (filePath, directory) => {
        const repository = createLocalRepositoryStream(directory, {
          empty: race,
          onPush: ({ attempt, runGit, writer, workDir }) => {
            if (attempt !== 1) {
              return null;
            }
            if (race) {
              fs.writeFileSync(
                path.join(writer, 'concurrent.txt'),
                'first remote commit\n'
              );
              runGit(['add', '.'], writer);
              runGit(['commit', '-q', '-m', 'Create remote branch'], writer);
              runGit(['push', '-q', 'origin', 'main'], writer);
            } else {
              runGit(['push', '-q', 'origin', 'main'], workDir);
            }
            return { code: 1, stderr: 'RPC failed; HTTP 408' };
          },
        });
        const result = await uploadLog({
          filePath,
          onlyRepository: true,
          pushRetryDelayMs: 0,
          logger: quietLogger,
          commandStreamFactory: () => repository.stream,
        });
        try {
          assert.equal(repository.attempts, 2);
          assert.equal(
            repository.runGit([
              '--git-dir',
              repository.remote,
              'show',
              `main:${result.repositoryPath}/session.log.txt`,
            ]),
            'tiny log\n'
          );
          assert.equal(
            repository
              .runGit([
                '--git-dir',
                repository.remote,
                'rev-list',
                '--count',
                'main',
              ])
              .trim(),
            '2'
          );
        } finally {
          fs.rmSync(result.workDir, { recursive: true, force: true });
        }
      });
    }
  },
  3: async () => {
    const { createLocalRepositoryStream } =
      await import('../experiments/issue-45-local-git.mjs');
    await withLog('one\ntwo\ntri\nend\n', async (filePath, directory) => {
      let phase = 1;
      const repository = createLocalRepositoryStream(directory, {
        onPush: ({ attempt }) =>
          (phase === 1 && attempt > 2) || (phase === 2 && attempt > 6)
            ? { code: 1, stderr: 'RPC failed; HTTP 408' }
            : null,
      });
      const options = {
        filePath,
        onlyRepository: true,
        pushRetryDelayMs: 0,
        logger: quietLogger,
        commandStreamFactory: () => repository.stream,
      };
      await assert.rejects(uploadLog({ ...options, chunkSize: 4 }), /HTTP 408/);
      phase = 2;
      await assert.rejects(
        uploadLog({ ...options, chunkSize: 12 }),
        /HTTP 408/
      );
      phase = 3;
      const result = await uploadLog({ ...options, chunkSize: 12 });
      try {
        assert.equal(result.deduplicated, false);
        assert.equal(result.fileCount, 2);
        const parts = ['00', '01'].map((index) =>
          repository.runGit([
            '--git-dir',
            repository.remote,
            'show',
            `main:${result.repositoryPath}/session.part-${index}.log.txt`,
          ])
        );
        assert.equal(parts.join(''), 'one\ntwo\ntri\nend\n');
        const duplicate = await uploadLog({ ...options, chunkSize: 4 });
        assert.equal(duplicate.deduplicated, true);
        assert.equal(duplicate.fileCount, 2);
      } finally {
        fs.rmSync(result.workDir, { recursive: true, force: true });
      }
    });
  },
};

const selected = process.argv[2] ? [process.argv[2]] : Object.keys(scenarios);
for (const name of selected) {
  await scenarios[name]();
  console.log(`Git scenario ${name} passed`);
}

import { test } from 'test-anywhere';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  testWithTimeout,
  runGitScenario,
} from '../experiments/real-git-test-utils.mjs';
import { splitFileIntoChunks, uploadLog } from '../src/index.js';

const quietLogger = { log() {}, warn() {}, error() {} };

async function withLog(content, run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-45-'));
  const filePath = path.join(directory, 'session.log');
  fs.writeFileSync(filePath, content);
  try {
    return await run(filePath, directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function repositoryStream({ commands, push, existing = [] }) {
  const bind =
    (options = {}) =>
    (strings, ...values) => {
      if (!Array.isArray(strings?.raw)) {
        return bind(strings);
      }
      const command = strings.reduce(
        (text, part, index) => text + part + (values[index] ?? ''),
        ''
      );
      commands.push(command);
      if (command === 'gh api user --jq .login') {
        return Promise.resolve({ code: 0, stdout: 'test-user' });
      }
      if (command.includes('--jq {"defaultBranch"')) {
        return Promise.resolve({
          code: 0,
          stdout: '{"defaultBranch":"main","visibility":"private"}',
        });
      }
      if (command.includes('/contents/')) {
        return Promise.resolve({ code: 0, stdout: JSON.stringify(existing) });
      }
      if (command.startsWith('git push ')) {
        return Promise.resolve(push(command, options));
      }
      if (command.startsWith('git diff --cached --quiet')) {
        return Promise.resolve({ code: 1, stdout: '' });
      }
      return Promise.resolve({ code: 0, stdout: '' });
    };
  return bind();
}

async function upload(filePath, configuration = {}) {
  const commands = [];
  const result = await uploadLog({
    filePath,
    onlyRepository: true,
    logger: quietLogger,
    pushRetryDelayMs: 0,
    ...configuration,
    commandStreamFactory: () =>
      repositoryStream({
        commands,
        push: () => ({ code: 0, stdout: '' }),
        ...configuration,
      }),
  });
  if (result.workDir) {
    fs.rmSync(result.workDir, { recursive: true, force: true });
  }
  return { result, commands };
}

for (const failure of [
  'error: RPC failed; HTTP 408 curl 22 The requested URL returned error: 408',
  'fatal: the remote end hung up unexpectedly',
  'send-pack: unexpected disconnect while reading sideband packet',
  'fatal: unable to access remote: The requested URL returned error: 429',
  'fatal: unable to access remote: The requested URL returned error: 503',
  '! [rejected] main -> main (fetch first)',
]) {
  test(`issue #45 - retries a push after ${failure}`, async () => {
    await withLog('log\n', async (filePath) => {
      let attempts = 0;
      const { commands } = await upload(filePath, {
        push: () => ({ code: ++attempts === 1 ? 1 : 0, stderr: failure }),
      });
      assert.equal(attempts, 2);
      const pushIndex = commands.findIndex((item) =>
        item.startsWith('git push ')
      );
      assert.ok(
        commands
          .slice(pushIndex + 1)
          .some((item) => item.startsWith('git fetch '))
      );
      assert.ok(
        commands
          .slice(pushIndex + 1)
          .some((item) => item.startsWith('git rebase '))
      );
    });
  });
}

test('issue #45 - authentication failure stops after one attempt', async () => {
  await withLog('log\n', async (filePath) => {
    let attempts = 0;
    await assert.rejects(
      upload(filePath, {
        push: () => {
          attempts += 1;
          return { code: 128, stderr: 'fatal: Authentication failed' };
        },
      }),
      /Authentication failed/
    );
    assert.equal(attempts, 1);
  });
});

test('issue #45 - transient retries stop after three attempts', async () => {
  await withLog('log\n', async (filePath) => {
    let attempts = 0;
    await assert.rejects(
      upload(filePath, {
        push: () => {
          attempts += 1;
          return { code: 1, stderr: 'error: RPC failed; HTTP 408' };
        },
      }),
      /HTTP 408/
    );
    assert.equal(attempts, 3);
  });
});

test('issue #45 - commits and pushes each chunk before staging the next', async () => {
  await withLog('one\ntwo\ntri\nend\n', async (filePath) => {
    let attempts = 0;
    const { commands, result } = await upload(filePath, {
      chunkSize: 8,
      push: () => ({
        code: ++attempts === 2 ? 1 : 0,
        stderr: 'error: RPC failed; HTTP 408',
      }),
    });
    assert.equal(result.fileCount, 2);
    assert.equal(attempts, 3);
    assert.equal(
      commands.filter((item) => item.startsWith('git commit ')).length,
      2
    );
    const firstPush = commands.findIndex((item) =>
      item.startsWith('git push ')
    );
    const secondStage = commands.findIndex(
      (item) => item.startsWith('git add ') && item.includes('part-01')
    );
    assert.ok(firstPush < secondStage);
    assert.ok(!commands.includes('git add .'));
  });
});

test('issue #45 - one existing chunk is an incomplete upload', async () => {
  await withLog('one\ntwo\ntri\nend\n', async (filePath) => {
    const { result, commands } = await upload(filePath, {
      chunkSize: 8,
      existing: [
        { name: 'session.part-00.log.txt', size: 8, download_url: null },
      ],
    });
    assert.equal(result.deduplicated, false);
    assert.equal(result.fileCount, 2);
    assert.ok(commands.some((item) => item.startsWith('git push ')));
  });
});

test('issue #45 - splitting respects byte limits and whole lines', async () => {
  await withLog('one\ntwo\ntri\nend\n', async (filePath, directory) => {
    const chunks = await splitFileIntoChunks(
      filePath,
      path.join(directory, 'chunks'),
      8
    );
    assert.deepEqual(
      chunks.map((file) => fs.readFileSync(file, 'utf8')),
      ['one\ntwo\n', 'tri\nend\n']
    );
  });
});

test('issue #45 - an oversized line keeps UTF-8 characters intact', async () => {
  const content = 'a🙂é世界🙂\nlast';
  await withLog(content, async (filePath, directory) => {
    const chunks = await splitFileIntoChunks(
      filePath,
      path.join(directory, 'chunks'),
      8
    );
    const buffers = chunks.map((file) => fs.readFileSync(file));
    assert.ok(buffers.length > 1);
    for (const bytes of buffers) {
      assert.ok(bytes.length <= 8);
      assert.deepEqual(Buffer.from(bytes.toString('utf8')), bytes);
    }
    assert.equal(Buffer.concat(buffers).toString('utf8'), content);
  });
});

testWithTimeout(
  'issue #45 - real Git rebases onto a concurrent shallow-clone update',
  () => runGitScenario('0')
);

testWithTimeout(
  'issue #45 - real Git resumes only the missing chunk after exhaustion',
  () => runGitScenario('1')
);

testWithTimeout(
  'issue #45 - real Git handles a lost acknowledgement and a new-branch race',
  () => runGitScenario('2')
);

test('issue #45 - retry delays increase exponentially and can be disabled', async () => {
  const { pushWithRetry, isRetryablePushError } =
    await import('../src/git-push.js');
  const delays = [];
  const commands = [];
  let attempts = 0;
  const stream = repositoryStream({
    commands,
    push: () => ({
      code: ++attempts < 3 ? 1 : 0,
      stderr: 'RPC failed; HTTP 500',
    }),
  });
  const log = { debug() {}, warn() {} };
  await pushWithRetry(stream, {
    defaultBranch: 'main',
    repositoryName: 'private-logs',
    log,
    sleepFn: (delay) => {
      delays.push(delay);
    },
  });
  assert.deepEqual(delays, [1000, 2000]);
  attempts = 0;
  await assert.rejects(
    pushWithRetry(stream, {
      defaultBranch: 'main',
      repositoryName: 'private-logs',
      log,
      pushRetries: 0,
    }),
    /HTTP 500/
  );
  assert.equal(attempts, 1);
  for (const failure of [
    'RPC failed; HTTP 403',
    "GH001: exceeds GitHub's file size limit; unexpected disconnect",
    'pre-receive hook declined',
    'Permission denied (publickey)',
  ]) {
    assert.equal(isRetryablePushError(failure), false);
  }
  for (const retries of [Infinity, NaN, -1, 1.5, 11]) {
    await assert.rejects(
      pushWithRetry(stream, {
        defaultBranch: 'main',
        repositoryName: 'private-logs',
        log,
        pushRetries: retries,
      }),
      /pushRetries/
    );
  }
});

test('issue #45 - complete new and legacy chunks still deduplicate', async () => {
  await withLog('one\ntwo\ntri\nend\n', async (filePath) => {
    for (const existing of [
      [
        { name: 'session.part-00.log.txt' },
        { name: 'session.part-01.log.txt' },
        { name: '.session.log.txt.complete' },
      ],
      [
        { name: 'session.part-00.log.txt', size: 8 },
        { name: 'session.part-01.log.txt', size: 8 },
      ],
    ]) {
      const { result, commands } = await upload(filePath, {
        existing,
        chunkSize: 4,
      });
      assert.equal(result.deduplicated, true);
      assert.equal(result.fileCount, 2);
      assert.ok(!commands.some((item) => item.startsWith('git push ')));
    }
  });
});

test('issue #45 - byte-preserving splitting covers CRLF, final lines and many parts', async () => {
  for (const content of [
    '',
    'one\r\ntwo\r\nlast',
    '🙂'.repeat(125),
    `${'é'.repeat(20)}\n`,
  ]) {
    await withLog(content, async (filePath, directory) => {
      const chunks = await splitFileIntoChunks(
        filePath,
        path.join(directory, 'chunks'),
        4
      );
      const bytes = chunks.map((file) => fs.readFileSync(file));
      assert.equal(Buffer.concat(bytes).toString('utf8'), content);
      assert.deepEqual([...chunks].sort(), chunks);
      for (const chunk of bytes) {
        assert.ok(chunk.length <= 4);
        assert.deepEqual(Buffer.from(chunk.toString('utf8')), chunk);
      }
    });
  }
});

test('issue #45 - pending chunks cannot deduplicate just because sizes add up', async () => {
  await withLog('one\ntwo\ntri\nend\n', async (filePath) => {
    const { result } = await upload(filePath, {
      chunkSize: 12,
      existing: [
        { name: 'session.part-00.log.txt', size: 12 },
        { name: 'session.part-01.log.txt', size: 4 },
        { name: '.session.log.txt.pending' },
      ],
    });
    assert.equal(result.deduplicated, false);
  });
});

testWithTimeout(
  'issue #45 - real Git resumes mixed chunks after changing chunk size',
  () => runGitScenario('3')
);

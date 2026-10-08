import { test } from 'test-anywhere';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  uploadLog,
  uploadAsRepo,
  uploadAsGist,
  isTransientGistError,
} from '../src/index.js';

const logger = { log() {}, warn() {}, error() {} };

async function withLog(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-47-'));
  const filePath = path.join(directory, 'session.log');
  fs.writeFileSync(filePath, 'installation token diagnostic\n');
  try {
    return await run(filePath);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function installationStream({
  commands,
  metadataCode = 0,
  visibility = 'private',
  existing = [],
  missingBranch = false,
  pushCode = 0,
  gistError = 'Resource not accessible by integration (HTTP 403)',
}) {
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
      if (command.startsWith('gh gist create ')) {
        return { code: 1, stdout: '', stderr: gistError };
      }
      if (command.startsWith('gh api user ')) {
        return {
          code: 1,
          stdout: '',
          stderr: 'Resource not accessible by integration (HTTP 403)',
        };
      }
      if (command.startsWith('gh repo create ')) {
        throw new Error('Installation token must not create repositories');
      }
      if (command.includes('defaultBranch')) {
        return {
          code: metadataCode,
          stdout: metadataCode
            ? ''
            : JSON.stringify({ defaultBranch: 'main', visibility }),
          stderr: metadataCode
            ? `Target unavailable (HTTP ${metadataCode})`
            : '',
        };
      }
      if (command.includes('/contents/')) {
        return { code: 0, stdout: JSON.stringify(existing) };
      }
      if (command.startsWith('git fetch ') && missingBranch) {
        return {
          code: 1,
          stderr: "fatal: couldn't find remote ref feature/logs",
        };
      }
      if (command.startsWith('git push ')) {
        assert.ok(options.cwd, 'Push runs in isolated temporary checkout');
        return {
          code: pushCode,
          stderr: pushCode ? 'Permission denied (HTTP 403)' : '',
        };
      }
      return {
        code: command === 'git diff --cached --quiet' ? 1 : 0,
        stdout: '',
      };
    };
  return bind();
}

async function upload(filePath, options = {}, state = {}, direct = false) {
  const commands = [];
  const result = await (direct ? uploadAsRepo : uploadLog)({
    filePath,
    repository: 'example-org/current-repo',
    branch: 'feature/logs',
    logger,
    pushRetryDelayMs: 0,
    ...options,
    commandStreamFactory: () => installationStream({ commands, ...state }),
  });
  if (result.workDir) {
    fs.rmSync(result.workDir, { recursive: true, force: true });
  }
  return { result, commands };
}

test('issue #47 - Gist 403 falls back to the explicit repository without GET /user or creation', async () => {
  await withLog(async (filePath) => {
    const { result, commands } = await upload(filePath, { isPublic: true });
    assert.equal(result.type, 'repo');
    assert.equal(result.repositoryName, 'current-repo');
    assert.equal(result.branch, 'feature/logs');
    assert.equal(result.isPublic, false, 'Existing repository visibility wins');
    assert.ok(
      result.url.startsWith(
        'https://github.com/example-org/current-repo/tree/feature/logs/'
      )
    );
    assert.equal(
      commands.filter((c) => c.startsWith('gh gist create ')).length,
      1
    );
    assert.ok(
      !commands.some(
        (c) => c.startsWith('gh api user ') || c.startsWith('gh repo create ')
      )
    );
    assert.ok(
      commands.includes('git push -q -u origin refs/heads/feature/logs')
    );
    const reads = commands.filter((c) => c.includes('/contents/'));
    assert.equal(reads.length, 2);
    assert.ok(
      reads.every(
        (c) => c.includes('--method GET') && c.includes('ref=feature/logs')
      ),
      'Deduplication and raw URLs must read the selected branch'
    );
  });
});

test('issue #47 - direct repository target overrides legacy mode and uses metadata default branch', async () => {
  await withLog(async (filePath) => {
    const { result, commands } = await upload(
      filePath,
      { branch: undefined, useSharedRepository: false },
      { visibility: 'public' },
      true
    );
    assert.equal(result.branch, 'main');
    assert.equal(result.isPublic, true);
    assert.ok(commands.includes('git push -q -u origin refs/heads/main'));
    assert.ok(!commands.some((c) => c.startsWith('gh api user ')));
  });
});

test('issue #47 - selected branch can deduplicate without fetching or pushing', async () => {
  await withLog(async (filePath) => {
    const rawUrl =
      'https://raw.githubusercontent.com/example-org/current-repo/feature/logs/session.log.txt';
    const { result, commands } = await upload(
      filePath,
      { onlyRepository: true },
      { existing: [{ name: 'session.log.txt', download_url: rawUrl }] }
    );
    assert.equal(result.deduplicated, true);
    assert.equal(result.rawUrl, rawUrl);
    assert.ok(
      commands
        .find((c) => c.includes('/contents/'))
        .includes('ref=feature/logs')
    );
    assert.ok(!commands.some((c) => c.startsWith('git ')));
  });
});

for (const code of [403, 404]) {
  test(`issue #47 - inaccessible explicit repository (HTTP ${code}) fails without creation or push`, async () => {
    await withLog(async (filePath) => {
      const commands = [];
      await assert.rejects(
        uploadAsRepo({
          filePath,
          repository: 'example-org/current-repo',
          logger,
          commandStreamFactory: () =>
            installationStream({ commands, metadataCode: code }),
        }),
        /current-repo|Target unavailable/
      );
      assert.ok(
        !commands.some(
          (c) =>
            c.startsWith('gh api user ') ||
            c.startsWith('gh repo create ') ||
            c.startsWith('git ')
        )
      );
    });
  });
}

test('issue #47 - missing explicit branch is never created implicitly', async () => {
  await withLog(async (filePath) => {
    await assert.rejects(
      upload(filePath, { onlyRepository: true }, { missingBranch: true }),
      /feature\/logs/
    );
  });
});

test('issue #47 - permanent target push failure is reported', async () => {
  await withLog(async (filePath) => {
    await assert.rejects(
      upload(filePath, { onlyRepository: true }, { pushCode: 1 }),
      /Permission denied/
    );
  });
});

test('issue #47 - target URL encodes branch characters while API and Git keep the branch name', async () => {
  await withLog(async (filePath) => {
    const { result, commands } = await upload(filePath, {
      onlyRepository: true,
      branch: 'feature/logs#ci',
    });
    assert.ok(result.url.includes('/tree/feature/logs%23ci/'));
    assert.ok(
      commands.includes('git push -q -u origin refs/heads/feature/logs#ci')
    );
    assert.ok(
      commands
        .filter((command) => command.includes('/contents/'))
        .every((command) => command.includes('ref=feature/logs#ci'))
    );
  });
});

for (const options of [
  { repository: 'repo' },
  { repository: 'owner/repo/extra' },
  { repository: 'owner/..' },
  { repository: 'https://github.com/owner/repo' },
  { repository: '' },
  { branch: 'feature/logs' },
  { repository: 'owner/repo', branch: '--all' },
  { repository: 'owner/repo', branch: 'HEAD' },
  { repository: 'owner/repo', branch: 'bad..ref' },
  { repository: 'owner/repo', branch: 'bad:ref' },
  { repository: 'owner/repo', branch: 'feature/.hidden' },
  { repository: 'owner/repo', branch: 'feature/logs.lock' },
]) {
  test(`issue #47 - invalid target fails before any upload: ${JSON.stringify(options)}`, async () => {
    await withLog(async (filePath) => {
      const commands = [];
      await assert.rejects(
        uploadLog({
          filePath,
          logger,
          ...options,
          commandStreamFactory: () => installationStream({ commands }),
        }),
        /repository|branch/i
      );
      assert.deepEqual(commands, []);
      await assert.rejects(
        async () =>
          uploadAsRepo({
            filePath,
            logger,
            ...options,
            commandStreamFactory: () => installationStream({ commands }),
          }),
        /repository|branch/i
      );
      assert.deepEqual(commands, []);
    });
  });
}

test('issue #47 - permission 403 is permanent while a rate-limit 403 stays retryable', async () => {
  assert.equal(
    isTransientGistError('Resource not accessible by integration (HTTP 403)'),
    false
  );
  assert.equal(
    isTransientGistError('API rate limit exceeded (HTTP 403)'),
    true
  );
  assert.equal(
    isTransientGistError('You have exceeded a secondary rate limit (HTTP 403)'),
    true
  );
  await withLog(async (filePath) => {
    const commands = [];
    const waits = [];
    await assert.rejects(
      uploadAsGist({
        filePath,
        logger,
        gistRetries: 1,
        sleepFn: async (delay) => waits.push(delay),
        commandStreamFactory: () =>
          installationStream({
            commands,
            gistError: 'API rate limit exceeded (HTTP 403)',
          }),
      }),
      /rate limit/
    );
    assert.equal(
      commands.filter((c) => c.startsWith('gh gist create ')).length,
      2
    );
    assert.deepEqual(waits, [60000]);
  });
});

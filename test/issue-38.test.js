/**
 * Regression tests for issue #38
 *
 * https://github.com/link-foundation/gh-upload-log/issues/38
 *
 * 1. A file whose content changed must be uploaded again, even when a log with
 *    the same path was uploaded before.
 * 2. The stored path is `<directory>/<content-hash>/<file-name>.log.txt`, so
 *    several versions of the same path can coexist and the path is not
 *    duplicated in the file name.
 * 3. Only a folder that really contains the expected file counts as an existing
 *    upload; a partially written folder must be uploaded again.
 * 4. Transient gist failures (HTTP 502/503/504) are retried instead of being
 *    reported as a hard limit.
 */

import { test, assert } from 'test-anywhere';
import fs from 'node:fs';
import path from 'node:path';
import { cwd } from 'node:process';
import {
  GITHUB_GIST_DOCUMENTED_FILE_LIMIT,
  GITHUB_GIST_FILE_LIMIT,
  LOG_CONTENT_HASH_LENGTH,
} from '../src/common.js';
import {
  buildLogRepositoryPath,
  determineUploadStrategy,
  generateFileContentHash,
  generateLogDirectorySegment,
  generateStoredLogFileName,
  isStoredLogFileName,
  isTransientGistError,
  parseFileSize,
  resolveGistFileLimit,
  uploadLog,
} from '../src/index.js';

const testDir = path.join(cwd(), 'test', 'fixtures', 'issue-38');
fs.mkdirSync(testDir, { recursive: true });

function createCommandResult({ code = 0, stdout = '', stderr = '' } = {}) {
  return { code, stdout, stderr };
}

function buildCommand(strings, values) {
  let command = '';

  for (let index = 0; index < strings.length; index += 1) {
    command += strings[index];
    if (index < values.length) {
      command += String(values[index]);
    }
  }

  return command.trim();
}

function createFakeCommandStream(handler) {
  const commandStream = (optionsOrStrings, ...values) => {
    if (Array.isArray(optionsOrStrings?.raw)) {
      return Promise.resolve(handler(buildCommand(optionsOrStrings, values)));
    }

    return commandStream;
  };

  return commandStream;
}

/**
 * Fake `gh`/`git` command stream for shared repository uploads
 *
 * @param {object} options - Fake repository state
 * @param {Record<string, string[]>} options.folders - Existing folders mapped to file names
 * @param {string[]} options.commands - Array collecting every executed command
 * @returns {Function} Fake command stream
 */
function createSharedRepositoryStream({ folders = {}, commands = [] } = {}) {
  const state = { ...folders };

  return createFakeCommandStream((command) => {
    commands.push(command);

    if (command === 'gh api user --jq .login') {
      return createCommandResult({ stdout: 'test-user\n' });
    }
    if (command.includes('--jq {"defaultBranch"')) {
      return createCommandResult({
        stdout: '{"defaultBranch":"main","visibility":"private"}\n',
      });
    }
    if (command.includes('/contents/')) {
      const folder = command
        .split('/contents/')[1]
        .split(' --jq')[0]
        .replace(/'/g, '');
      const files = state[folder];

      if (!files) {
        return createCommandResult({
          code: 1,
          stderr: 'gh: Not Found (HTTP 404)\n',
        });
      }

      return createCommandResult({
        stdout: JSON.stringify(
          files.map((name) => ({
            name,
            download_url: `https://raw.githubusercontent.com/test-user/private-logs/main/${folder}/${name}`,
          }))
        ),
      });
    }

    return createCommandResult();
  });
}

async function uploadToSharedRepository(filePath, folders, commands) {
  return uploadLog({
    filePath,
    onlyRepository: true,
    commandStreamFactory: () =>
      createSharedRepositoryStream({ folders, commands }),
  });
}

// --- path layout -------------------------------------------------------------

test('issue #38 - stored path is <directory>/<hash>/<file name> without duplication', async () => {
  const filePath = path.join(testDir, 'layout.log');
  fs.writeFileSync(filePath, 'layout\n');

  const absolute = path.resolve(filePath);
  const contentHash = await generateFileContentHash(absolute);
  const repositoryPath = buildLogRepositoryPath(absolute, contentHash);

  assert.equal(contentHash.length, LOG_CONTENT_HASH_LENGTH);
  assert.equal(
    repositoryPath,
    `${generateLogDirectorySegment(absolute)}/${contentHash}`
  );
  assert.ok(
    !repositoryPath.startsWith('log-'),
    'Repository path should not repeat the legacy log- prefix'
  );
  assert.equal(generateStoredLogFileName(absolute), 'layout.log.txt');
  assert.ok(
    !generateStoredLogFileName(absolute).includes(
      generateLogDirectorySegment(absolute)
    ),
    'Stored file name should not duplicate the directory path'
  );
});

test('issue #38 - the example from the issue maps to home-box/<hash>/file.log.txt', () => {
  const filePath = '/home/box/hive-telegram-bot.log';

  assert.equal(generateLogDirectorySegment(filePath), 'home-box');
  assert.equal(
    buildLogRepositoryPath(filePath, '0123456789abcdef'),
    'home-box/0123456789abcdef'
  );
  assert.equal(
    generateStoredLogFileName(filePath),
    'hive-telegram-bot.log.txt'
  );
});

test('issue #38 - chunked uploads are recognized as the stored log file', () => {
  assert.equal(isStoredLogFileName('app.log.txt', 'app.log.txt'), true);
  assert.equal(
    isStoredLogFileName('app.part-000.log.txt', 'app.log.txt'),
    true
  );
  assert.equal(isStoredLogFileName('other.log.txt', 'app.log.txt'), false);
});

// --- re-upload on change (the actual bug) ------------------------------------

test('issue #38 - changed content is uploaded again into a new hash folder', async () => {
  const filePath = path.join(testDir, 'changing.log');
  fs.writeFileSync(filePath, 'first version\n');

  const absolute = path.resolve(filePath);
  const firstHash = await generateFileContentHash(absolute);
  const firstFolder = buildLogRepositoryPath(absolute, firstHash);
  const storedFileName = generateStoredLogFileName(absolute);

  // The first version is already in the repository (as if uploaded before).
  const folders = { [firstFolder]: [storedFileName] };

  const first = await uploadToSharedRepository(filePath, folders, []);
  assert.equal(first.deduplicated, true, 'Identical content is deduplicated');
  assert.equal(first.repositoryPath, firstFolder);

  // Now the log grows, exactly like the 30.98MB → 31.02MB case in the issue.
  fs.appendFileSync(filePath, 'second version\n');
  const secondHash = await generateFileContentHash(absolute);
  const secondFolder = buildLogRepositoryPath(absolute, secondHash);
  const commands = [];
  const second = await uploadToSharedRepository(filePath, folders, commands);

  assert.ok(
    secondHash !== firstHash,
    'Changed content must produce a different hash'
  );
  assert.equal(
    second.deduplicated,
    false,
    'Changed content must be uploaded again instead of being skipped'
  );
  assert.equal(second.repositoryPath, secondFolder);
  assert.ok(
    second.repositoryPath !== first.repositoryPath,
    'Both versions must live in different folders'
  );
  assert.ok(
    commands.some((command) => command.includes('git push -q -u origin main')),
    'The changed file must actually be pushed'
  );
  assert.ok(
    fs.existsSync(path.join(second.workDir, secondFolder, storedFileName)),
    'The changed file must be staged for upload'
  );

  fs.rmSync(second.workDir, { recursive: true, force: true });
});

test('issue #38 - identical content reuses the existing file that really exists', async () => {
  const filePath = path.join(testDir, 'identical.log');
  fs.writeFileSync(filePath, 'identical content\n');

  const absolute = path.resolve(filePath);
  const folder = buildLogRepositoryPath(
    absolute,
    await generateFileContentHash(absolute)
  );
  const storedFileName = generateStoredLogFileName(absolute);
  const commands = [];

  const result = await uploadToSharedRepository(
    filePath,
    { [folder]: [storedFileName] },
    commands
  );

  assert.equal(result.deduplicated, true);
  assert.equal(result.fileName, storedFileName);
  assert.equal(
    result.rawUrl,
    `https://raw.githubusercontent.com/test-user/private-logs/main/${folder}/${storedFileName}`
  );
  assert.ok(
    !commands.some((command) => command.includes('git push')),
    'Deduplicated uploads must not push anything'
  );
});

test('issue #38 - a folder without the expected file is uploaded again', async () => {
  const filePath = path.join(testDir, 'partial.log');
  fs.writeFileSync(filePath, 'partial upload\n');

  const absolute = path.resolve(filePath);
  const folder = buildLogRepositoryPath(
    absolute,
    await generateFileContentHash(absolute)
  );
  const commands = [];

  // The folder exists but holds an unrelated leftover file: a previous upload
  // that never finished. Reporting it as "already exists" loses the log.
  const result = await uploadToSharedRepository(
    filePath,
    { [folder]: ['unrelated-file.txt'] },
    commands
  );

  assert.equal(
    result.deduplicated,
    false,
    'An incomplete folder must not be treated as an existing upload'
  );
  assert.ok(
    commands.some((command) => command.includes('git push -q -u origin main')),
    'The missing file must be pushed'
  );

  fs.rmSync(result.workDir, { recursive: true, force: true });
});

test('issue #38 - dedicated repository mode uses the same hashed layout', async () => {
  const filePath = path.join(testDir, 'dedicated.log');
  fs.writeFileSync(filePath, 'dedicated repository\n');

  const absolute = path.resolve(filePath);
  const expectedPath = buildLogRepositoryPath(
    absolute,
    await generateFileContentHash(absolute)
  );
  const commands = [];

  const result = await uploadLog({
    filePath,
    onlyRepository: true,
    useSharedRepository: false,
    commandStreamFactory: () =>
      createFakeCommandStream((command) => {
        commands.push(command);

        if (command === 'gh api user --jq .login') {
          return createCommandResult({ stdout: 'test-user\n' });
        }
        if (command.includes('/contents/')) {
          return createCommandResult({
            code: 1,
            stderr: 'gh: Not Found (HTTP 404)\n',
          });
        }

        return createCommandResult();
      }),
  });

  assert.equal(result.repositoryPath, expectedPath);
  assert.ok(
    fs.existsSync(
      path.join(
        result.workDir,
        expectedPath,
        generateStoredLogFileName(absolute)
      )
    ),
    'Dedicated repository uploads must use the hashed folder too'
  );

  fs.rmSync(result.workDir, { recursive: true, force: true });
});

// --- gist size limit ---------------------------------------------------------

test('issue #38 - the gist limit is configurable and clamped to the documented maximum', () => {
  assert.equal(resolveGistFileLimit(undefined), GITHUB_GIST_FILE_LIMIT);
  assert.equal(resolveGistFileLimit('40MB'), GITHUB_GIST_FILE_LIMIT);
  assert.equal(resolveGistFileLimit(40 * 1024 * 1024), 40 * 1024 * 1024);
  assert.equal(
    resolveGistFileLimit(500 * 1024 * 1024),
    GITHUB_GIST_DOCUMENTED_FILE_LIMIT
  );
  assert.equal(resolveGistFileLimit(0), 0);
});

test('issue #38 - parseFileSize understands the sizes users type', () => {
  assert.equal(parseFileSize('25MB'), 25 * 1024 * 1024);
  assert.equal(parseFileSize('25'), 25 * 1024 * 1024);
  assert.equal(parseFileSize('1.5 GB'), 1.5 * 1024 * 1024 * 1024);
  assert.equal(parseFileSize('1024B'), 1024);
  assert.equal(parseFileSize('512kb'), 512 * 1024);
  assert.equal(parseFileSize('not a size'), null);
  assert.equal(parseFileSize(''), null);
});

test('issue #38 - a raised gist limit keeps large files in gist mode', () => {
  const filePath = path.join(testDir, 'large-for-gist.log');
  const fd = fs.openSync(filePath, 'w');
  fs.ftruncateSync(fd, 31 * 1024 * 1024);
  fs.closeSync(fd);

  assert.equal(determineUploadStrategy(filePath).type, 'repo');
  assert.equal(
    determineUploadStrategy(filePath, { gistFileLimit: parseFileSize('40MB') })
      .type,
    'gist'
  );
});

test('issue #38 - transient GitHub errors are recognized for retrying', () => {
  assert.equal(isTransientGistError('HTTP 502: Bad Gateway'), true);
  assert.equal(isTransientGistError('HTTP 504 (gateway timeout)'), true);
  assert.equal(
    isTransientGistError(
      "GitHub couldn't respond to your request in time. Sorry about that."
    ),
    true
  );
  assert.equal(isTransientGistError('HTTP 422: Validation Failed'), false);
  assert.equal(isTransientGistError(''), false);
});

test('issue #38 - gist uploads retry after a transient GitHub error', async () => {
  const filePath = path.join(testDir, 'retry.log');
  fs.writeFileSync(filePath, 'retry me\n');

  const commands = [];
  let attempts = 0;

  const result = await uploadLog({
    filePath,
    onlyGist: true,
    commandStreamFactory: () =>
      createFakeCommandStream((command) => {
        commands.push(command);

        if (command.startsWith('gh gist create ')) {
          attempts += 1;

          if (attempts === 1) {
            return createCommandResult({
              code: 1,
              stderr: 'HTTP 502: Bad Gateway (https://api.github.com/gists)\n',
            });
          }

          return createCommandResult({
            stdout: 'https://gist.github.com/test-user/abc123\n',
          });
        }
        if (command.startsWith('gh api gists/')) {
          return createCommandResult({
            stdout:
              'https://gist.githubusercontent.com/test-user/abc123/raw/retry.log.txt\n',
          });
        }

        return createCommandResult();
      }),
  });

  assert.equal(attempts, 2, 'A transient error must be retried once');
  assert.equal(result.type, 'gist');
  assert.equal(result.url, 'https://gist.github.com/test-user/abc123');
});

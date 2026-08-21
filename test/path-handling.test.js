/**
 * Regression tests for issue #35
 *
 * 1. Every path form must be accepted (relative, `./`, `../`, `~/`, absolute),
 *    even though the working directory can change while the upload runs.
 * 2. `git init` must not print the "Using 'master' as the name for the initial
 *    branch" hint block.
 */

import { test, assert } from 'test-anywhere';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cwd } from 'node:process';
import {
  MAX_REPOSITORY_NAME_LENGTH,
  MAX_UPLOADED_FILE_NAME_LENGTH,
} from '../src/common.js';
import {
  generateRepoName,
  generateUploadedLogFileName,
  resolveLogFilePath,
  uploadLog,
} from '../src/index.js';

const testDir = path.join(cwd(), 'test', 'fixtures', 'path-handling');
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

/**
 * Fake command-stream tag that records the command text together with the
 * options the tag was bound with (`$({ cwd, mirror })`).
 */
function createRecordingCommandStream(handler, invocations) {
  const bind = (options) => {
    const tag = (strings, ...values) => {
      if (!Array.isArray(strings?.raw)) {
        return bind({ ...options, ...strings });
      }

      const command = buildCommand(strings, values);
      invocations.push({ command, options });
      return Promise.resolve(handler(command, options));
    };

    return tag;
  };

  return bind({});
}

// --- resolveLogFilePath ------------------------------------------------------

test('resolveLogFilePath - resolves a bare relative path', () => {
  assert.equal(resolveLogFilePath('app.log'), path.resolve('app.log'));
});

test('resolveLogFilePath - resolves an explicit ./ path', () => {
  assert.equal(resolveLogFilePath('./app.log'), path.resolve('app.log'));
});

test('resolveLogFilePath - resolves a parent-relative path', () => {
  assert.equal(
    resolveLogFilePath('../logs/app.log'),
    path.resolve('../logs/app.log')
  );
});

test('resolveLogFilePath - keeps absolute paths unchanged', () => {
  const absolute = path.join(os.tmpdir(), 'app.log');
  assert.equal(resolveLogFilePath(absolute), absolute);
});

test('resolveLogFilePath - expands a quoted home-relative path', () => {
  assert.equal(
    resolveLogFilePath('~/app.log'),
    path.join(os.homedir(), 'app.log')
  );
});

test('resolveLogFilePath - expands a lone tilde', () => {
  assert.equal(resolveLogFilePath('~'), path.resolve(os.homedir()));
});

test('resolveLogFilePath - rejects empty input', () => {
  try {
    resolveLogFilePath('');
    assert.ok(false, 'Expected resolveLogFilePath to throw for empty input');
  } catch (error) {
    assert.ok(error.message.includes('filePath is required'));
  }
});

test('generated names are identical for every form of the same path', () => {
  const file = path.join(testDir, 'same-file.log');
  fs.writeFileSync(file, 'same file\n');

  const absolute = path.resolve(file);
  const relative = path.relative(cwd(), file);
  const dotRelative = `./${relative}`;

  const repoNames = [absolute, relative, dotRelative].map((candidate) =>
    generateRepoName(resolveLogFilePath(candidate))
  );
  const fileNames = [absolute, relative, dotRelative].map((candidate) =>
    generateUploadedLogFileName(resolveLogFilePath(candidate))
  );

  assert.equal(repoNames[0], repoNames[1]);
  assert.equal(repoNames[1], repoNames[2]);
  assert.equal(fileNames[0], fileNames[1]);
  assert.equal(fileNames[1], fileNames[2]);
});

test('generated names stay within GitHub and git length limits', () => {
  const deepPath = `/${Array.from({ length: 40 }, (_, index) => `directory-segment-${index}`).join('/')}/application.log`;

  const repoName = generateRepoName(deepPath);
  const fileName = generateUploadedLogFileName(deepPath);

  assert.ok(
    repoName.length <= MAX_REPOSITORY_NAME_LENGTH,
    `Repository name should be at most ${MAX_REPOSITORY_NAME_LENGTH} characters, got ${repoName.length}`
  );
  assert.ok(
    fileName.length <= MAX_UPLOADED_FILE_NAME_LENGTH,
    `File name should be at most ${MAX_UPLOADED_FILE_NAME_LENGTH} characters, got ${fileName.length}`
  );
  assert.ok(
    repoName.startsWith('log-'),
    'Repository name keeps the log- prefix'
  );
  assert.ok(
    fileName.endsWith('.log.txt'),
    'File name keeps the browser-friendly extension'
  );
  assert.equal(
    generateRepoName(deepPath),
    repoName,
    'Shortening must be deterministic so deduplication keeps working'
  );
});

// --- uploads with a working directory that changes mid-run -------------------

test('uploadLog - accepts a relative path even when the working directory changes', async () => {
  const relativeFile = path.join(
    'test',
    'fixtures',
    'path-handling',
    'relative-upload.log'
  );
  fs.writeFileSync(relativeFile, 'relative upload\n');

  const originalCwd = cwd();
  const expectedFolder = generateRepoName(path.resolve(relativeFile));
  const expectedFileName = generateUploadedLogFileName(
    path.resolve(relativeFile)
  );
  const invocations = [];
  const wanderDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-upload-cwd-'));

  const fakeCommandStream = createRecordingCommandStream((command) => {
    // Reproduce command-stream's documented `cd` behaviour: running a command
    // may move the working directory of the host process itself.
    // See https://github.com/link-foundation/command-stream/issues/50
    process.chdir(wanderDir);

    if (command === 'gh api user --jq .login') {
      return createCommandResult({ stdout: 'test-user\n' });
    }
    if (command.includes('--jq {"defaultBranch"')) {
      return createCommandResult({
        stdout: '{"defaultBranch":"main","visibility":"private"}\n',
      });
    }
    if (command.includes('/contents/')) {
      return createCommandResult({
        code: 1,
        stderr: 'gh: Not Found (HTTP 404)\n',
      });
    }

    return createCommandResult();
  }, invocations);

  try {
    const result = await uploadLog({
      filePath: relativeFile,
      onlyRepository: true,
      commandStreamFactory: () => fakeCommandStream,
    });

    assert.equal(result.repositoryPath, expectedFolder);
    assert.ok(
      fs.existsSync(
        path.join(result.workDir, expectedFolder, expectedFileName)
      ),
      'The log file should be staged even after the working directory changed'
    );
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(wanderDir, { recursive: true, force: true });
  }
});

test('uploadLog - runs git commands through the cwd option instead of `cd`', async () => {
  const repoFile = path.join(testDir, 'cwd-option.log');
  fs.writeFileSync(repoFile, 'cwd option\n');

  const invocations = [];
  const fakeCommandStream = createRecordingCommandStream((command) => {
    if (command === 'gh api user --jq .login') {
      return createCommandResult({ stdout: 'test-user\n' });
    }
    if (command.includes('--jq {"defaultBranch"')) {
      return createCommandResult({
        stdout: '{"defaultBranch":"main","visibility":"private"}\n',
      });
    }
    if (command.includes('/contents/')) {
      return createCommandResult({
        code: 1,
        stderr: 'gh: Not Found (HTTP 404)\n',
      });
    }

    return createCommandResult();
  }, invocations);

  const result = await uploadLog({
    filePath: repoFile,
    onlyRepository: true,
    commandStreamFactory: () => fakeCommandStream,
  });

  assert.ok(
    !invocations.some(({ command }) => command.startsWith('cd ')),
    'No command should rely on a `cd` prefix'
  );

  const gitInvocations = invocations.filter(({ command }) =>
    command.startsWith('git ')
  );
  assert.ok(gitInvocations.length > 0, 'Expected git commands to run');
  assert.ok(
    gitInvocations.every(({ options }) => options.cwd === result.workDir),
    'Every git command should be bound to the temporary work directory'
  );
  assert.ok(
    invocations.every(({ options }) => options.mirror === false),
    'Command output should not be mirrored unless verbose mode is enabled'
  );
});

test('uploadLog - initializes git without the master branch hint', async () => {
  const repoFile = path.join(testDir, 'git-init-quiet.log');
  fs.writeFileSync(repoFile, 'git init quiet\n');

  const invocations = [];
  const fakeCommandStream = createRecordingCommandStream((command) => {
    if (command === 'gh api user --jq .login') {
      return createCommandResult({ stdout: 'test-user\n' });
    }
    if (command.includes('--jq {"defaultBranch"')) {
      return createCommandResult({
        stdout: '{"defaultBranch":"main","visibility":"private"}\n',
      });
    }
    if (command.includes('/contents/')) {
      return createCommandResult({
        code: 1,
        stderr: 'gh: Not Found (HTTP 404)\n',
      });
    }

    return createCommandResult();
  }, invocations);

  await uploadLog({
    filePath: repoFile,
    onlyRepository: true,
    commandStreamFactory: () => fakeCommandStream,
  });

  const initCommands = invocations
    .map(({ command }) => command)
    .filter((command) => command.includes(' init'));

  assert.ok(
    initCommands.some(
      (command) => command === 'git -c init.defaultBranch=main init -q'
    ),
    `Expected a quiet git init with an explicit default branch, got: ${JSON.stringify(initCommands)}`
  );
  assert.ok(
    !initCommands.some((command) => command === 'git init'),
    'Plain `git init` prints the master branch hint and must not be used'
  );
});

test('git init command produces no master branch hint when executed for real', async () => {
  const { $ } = await import('command-stream');
  const gitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-upload-log-init-'));

  try {
    const $gitDir = $({ cwd: gitDir, mirror: false, capture: true });
    const initResult = await $gitDir`git -c init.defaultBranch=main init -q`;
    const output = `${initResult.stdout}${initResult.stderr}`;

    assert.equal(initResult.code, 0, `git init failed: ${output}`);
    assert.ok(
      !output.includes('hint:'),
      `git init should not print hints, got: ${output}`
    );
    assert.ok(
      !output.toLowerCase().includes('master'),
      `git init should not mention master, got: ${output}`
    );

    const branchResult = await $gitDir`git branch --show-current`;
    assert.equal(branchResult.stdout.trim(), 'main');
    assert.equal(
      cwd(),
      path.resolve(cwd()),
      'Running commands with the cwd option must not change the process directory'
    );
  } finally {
    fs.rmSync(gitDir, { recursive: true, force: true });
  }
});

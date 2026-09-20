import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assert, test } from 'test-anywhere';
import { publishWithRetries } from '../scripts/publish-to-npm.mjs';
import {
  setupNpm,
  TRUSTED_PUBLISHING_NPM_RANGE,
} from '../scripts/setup-npm.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function commandResult(code, stderr = '') {
  return { code, stdout: '', stderr };
}

function fakeCommandStream(responses, commands) {
  return (strings, ...values) => {
    const command = strings.reduce(
      (text, part, index) => text + part + (values[index] ?? ''),
      ''
    );
    commands.push(command);
    const result = responses(command);
    const promise = Promise.resolve(result);
    promise.run = async () => result;
    return promise;
  };
}

test('publishWithRetries rejects non-zero command results after all attempts', async () => {
  let attempts = 0;
  const delays = [];
  let thrown;

  try {
    await publishWithRetries(
      async () => {
        attempts += 1;
        return commandResult(1, 'npm error E404 Not Found');
      },
      {
        maxRetries: 3,
        retryDelay: 10,
        sleepFn: async (delay) => delays.push(delay),
        logger: { log() {} },
      }
    );
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown, 'A failed npm publish must reject');
  assert.ok(
    thrown.message.includes('npm error E404 Not Found'),
    `The final error should preserve npm diagnostics, got: ${thrown.message}`
  );
  assert.equal(attempts, 3, 'Every configured attempt should run');
  assert.equal(delays.length, 2, 'Retries should wait between attempts only');
});

test('publishWithRetries succeeds only after a zero command exit code', async () => {
  let attempts = 0;

  const result = await publishWithRetries(
    async () => {
      attempts += 1;
      return commandResult(attempts === 2 ? 0 : 1, 'temporary failure');
    },
    {
      retryDelay: 0,
      sleepFn: async () => {},
      logger: { log() {} },
    }
  );

  assert.equal(attempts, 2);
  assert.equal(result.code, 0);
});

test('release workflow uses an OIDC-compatible Node and npm toolchain', () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, '..', '.github', 'workflows', 'release.yml'),
    'utf8'
  );
  const node24Setups = workflow.match(/node-version: '24\.x'/g) || [];

  assert.equal(
    node24Setups.length,
    2,
    'Both automatic and manual npm publishing jobs must use Node 24'
  );
  assert.equal(TRUSTED_PUBLISHING_NPM_RANGE, '^11.5.1');
});

test('setupNpm rejects when the npm upgrade command has a non-zero exit code', async () => {
  const commands = [];
  const commandStream = fakeCommandStream((command) => {
    if (command === 'npm --version') {
      return { ...commandResult(0), stdout: '10.8.2\n' };
    }
    return commandResult(1, 'npm error code EBADENGINE');
  }, commands);
  let thrown;

  try {
    await setupNpm(commandStream);
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown, 'An npm upgrade failure must reject');
  assert.ok(thrown.message.includes('EBADENGINE'));
  assert.equal(
    commands.length,
    2,
    'Version verification must not run after failure'
  );
});

test('release-note parent fails when its formatter child exits non-zero', () => {
  const projectRoot = path.join(__dirname, '..');
  const fakeBin = fs.mkdtempSync(
    path.join(os.tmpdir(), 'gh-upload-log-release-test-')
  );
  const fakeGhScript = path.join(fakeBin, 'fake-gh.mjs');
  const fakeGh = path.join(fakeBin, 'gh');

  try {
    fs.writeFileSync(
      fakeGhScript,
      [
        'const args = process.argv.slice(2);',
        "if (process.argv.includes('--jq')) {",
        "  console.log('123');",
        '  process.exit(0);',
        '}',
        "if (args.includes('-X')) {",
        "  console.error('simulated formatter child failure');",
        '  process.exit(42);',
        '}',
        "if (args.some((argument) => argument.includes('/commits/'))) {",
        "  console.log('[]');",
        '  process.exit(0);',
        '}',
        "console.log(JSON.stringify({ body: '### Patch Changes\\n- Test change' }));",
        '',
      ].join('\n')
    );
    fs.writeFileSync(
      fakeGh,
      `#!${process.execPath}\nimport './fake-gh.mjs';\n`,
      { mode: 0o755 }
    );
    fs.writeFileSync(
      `${fakeGh}.cmd`,
      `@echo off\r\n"${process.execPath}" "%~dp0\\fake-gh.mjs" %*\r\n`
    );

    const result = spawnSync(
      process.execPath,
      [
        path.join(projectRoot, 'scripts', 'format-github-release.mjs'),
        '--release-version',
        '9.9.9',
        '--repository',
        'owner/repository',
        '--commit-sha',
        'abc123',
      ],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ''}`,
        },
        encoding: 'utf8',
      }
    );
    const output = `${result.stdout || ''}${result.stderr || ''}`;

    assert.notEqual(
      result.status,
      0,
      `Parent must fail after a failed formatter child. Output:\n${output}`
    );
    assert.ok(
      output.includes('simulated formatter child failure'),
      `The Bun formatter child must run and preserve its diagnostics. Output:\n${output}`
    );
    assert.ok(
      !output.includes('✅ Formatted release notes for v9.9.9'),
      `Parent must not claim formatting succeeded. Output:\n${output}`
    );
  } finally {
    fs.rmSync(fakeBin, { recursive: true, force: true });
  }
}, 30000);

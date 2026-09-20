import fs from 'node:fs';
import path from 'node:path';
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

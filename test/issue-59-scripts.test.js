import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, test } from 'test-anywhere';
import { versionAndCommit } from '../scripts/version-and-commit.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function fakeCommandStream(failing, commands) {
  return (strings, ...values) => {
    const command = strings.reduce(
      (text, part, index) => text + part + (values[index] ?? ''),
      ''
    );
    commands.push(command);
    const result = {
      code: failing.test(command) ? 1 : 0,
      stdout: command.startsWith('git rev-parse') ? 'abc\n' : '',
      stderr: failing.test(command) ? 'remote rejected' : '',
    };
    const promise = Promise.resolve(result);
    promise.run = async () => result;
    return promise;
  };
}

async function runVersioning(failing, status = ' M package.json') {
  const commands = [];
  const outputs = {};
  let error;
  const stream = fakeCommandStream(failing, commands);
  try {
    await versionAndCommit({
      mode: 'changeset',
      $: (strings, ...values) => {
        const promise = stream(strings, ...values);
        if (strings.join('').startsWith('git status')) {
          const result = { code: 0, stdout: status, stderr: '' };
          promise.run = async () => result;
        }
        return promise;
      },
      setOutput: (key, value) => {
        outputs[key] = value;
      },
      readVersion: () => '1.0.0',
      changesetCount: () => 1,
      logger: { log() {} },
    });
  } catch (caught) {
    error = caught;
  }
  return { commands, outputs, error };
}

test('a rejected git push fails versioning instead of reporting a commit', async () => {
  const { outputs, error } = await runVersioning(/^git push/);
  assert.ok(error, 'Expected versionAndCommit to throw');
  assert.ok(error.message.includes('push version commit to main'));
  assert.equal(outputs.version_committed, undefined);
});

test('a failing changeset version stops before committing', async () => {
  const { commands, error } = await runVersioning(/changeset:version/);
  assert.ok(error.message.includes('run changeset version'));
  assert.ok(!commands.some((command) => command.startsWith('git commit')));
});

test('a successful run commits, pushes and reports the commit', async () => {
  const { commands, outputs, error } = await runVersioning(/^$/);
  assert.equal(error, undefined);
  assert.ok(commands.includes('git commit -m 1.0.0'));
  assert.ok(commands.includes('git push origin main'));
  assert.equal(outputs.version_committed, 'true');
});

test('release scripts check every command and load no code from unpkg', () => {
  const scriptsDir = path.join(root, 'scripts');
  for (const file of fs.readdirSync(scriptsDir)) {
    if (!file.endsWith('.mjs')) {
      continue;
    }
    const source = fs.readFileSync(path.join(scriptsDir, file), 'utf8');
    assert.ok(
      !source.includes('unpkg.com/use-m'),
      `${file} must import dependencies statically instead of eval-ing unpkg`
    );
    if (/\$`/.test(source)) {
      assert.ok(
        source.includes('ensureCommandSucceeded'),
        `${file} runs command-stream commands without ensureCommandSucceeded`
      );
    }
  }
});

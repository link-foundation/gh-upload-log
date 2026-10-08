import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { test } from 'test-anywhere';
import {
  testWithTimeout,
  spawnGitSync,
  runGitScenario,
  REAL_GIT_TEST_TIMEOUT_MS,
  GIT_SCENARIO_TIMEOUT_MS,
  GIT_COMMAND_TIMEOUT_MS,
} from '../experiments/real-git-test-utils.mjs';

test('issue #49 - hung Git command names the command and preserves diagnostics', () => {
  const timeoutError = Object.assign(new Error('spawnSync git ETIMEDOUT'), {
    code: 'ETIMEDOUT',
  });
  assert.throws(
    () =>
      spawnGitSync(
        ['fetch', 'origin', 'main'],
        { cwd: '/test-repository' },
        (command, args, options) => {
          assert.equal(command, 'git');
          assert.deepEqual(args, ['fetch', 'origin', 'main']);
          assert.equal(options.cwd, '/test-repository');
          assert.equal(options.timeout, GIT_COMMAND_TIMEOUT_MS);
          assert.ok(options.timeout < GIT_SCENARIO_TIMEOUT_MS);
          return {
            error: timeoutError,
            stdout: 'partial progress\n',
            stderr: 'remote diagnostic\n',
          };
        }
      ),
    (error) => {
      assert.match(
        error.message,
        /git fetch origin main: timed out after 10000ms/
      );
      assert.match(error.message, /partial progress/);
      assert.match(error.message, /remote diagnostic/);
      assert.equal(error.cause, timeoutError);
      return true;
    }
  );
});

test('issue #49 - scenario deadline leaves time for its error before the test deadline', () => {
  assert.throws(
    () =>
      runGitScenario('3', (command, args, options) => {
        assert.equal(command, 'node');
        assert.equal(args[1], '3');
        assert.equal(options.timeout, GIT_SCENARIO_TIMEOUT_MS);
        assert.ok(options.timeout < REAL_GIT_TEST_TIMEOUT_MS);
        return {
          error: Object.assign(new Error('spawnSync node ETIMEDOUT'), {
            code: 'ETIMEDOUT',
          }),
          stderr: 'last Git diagnostic',
        };
      }),
    /Git scenario 3: timed out after 45000ms\nlast Git diagnostic/
  );
});

test('issue #49 - failed scenario retains the Git command failure', () => {
  assert.throws(
    () =>
      runGitScenario('2', () => ({
        status: 1,
        stderr: 'git push origin main: timed out after 10000ms',
      })),
    /Git scenario 2: exited with status 1\ngit push origin main: timed out/
  );
});

testWithTimeout(
  'issue #49 - real Git test tolerates startup longer than Bun default',
  () => {
    const slowGit = new URL(
      '../experiments/issue-49-slow-git.mjs',
      import.meta.url
    ).href;
    const result = spawnSync(
      process.versions.bun ? process.execPath : 'bun',
      [
        'test',
        fileURLToPath(new URL('./issue-45.test.js', import.meta.url)),
        '--test-name-pattern',
        '^issue #45 - real Git resumes mixed chunks after changing chunk size$',
      ],
      {
        encoding: 'utf8',
        timeout: 70_000,
        env: {
          ...process.env,
          NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import=${slowGit}`,
        },
      }
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /1 pass/);
  },
  75_000
);

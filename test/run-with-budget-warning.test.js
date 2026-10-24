import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert } from 'test-anywhere';
import { itUnless, sandboxed } from './helpers/skip.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// On Windows a bare `bash` can resolve to WSL's System32 launcher rather than
// the Git Bash that runs this script in CI, so the timing tests are POSIX-only.
const windowsBash =
  process.platform === 'win32'
    ? 'bash on PATH may be WSL rather than Git Bash'
    : null;

function runBudget(budget, command, env = {}) {
  return spawnSync(
    'bash',
    ['scripts/run-with-budget-warning.sh', String(budget), 'step', ...command],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        BUDGET_POLL_SECONDS: '0.1',
        BUDGET_GRACE_SECONDS: '1',
        BUDGET_KILL_SECONDS: '1',
        ...env,
      },
    }
  );
}

function waitForMillisecond(from, to) {
  while (Date.now() % 1000 < from || Date.now() % 1000 >= to) {
    // Busy-wait: the bug depends on where in a wall-clock second SECONDS=0 runs.
  }
}

// bash's SECONDS counts second boundaries, so started 0.75s into a second it
// reads 2 after about 1.25s; `-ge` then killed this command (template #252).
itUnless(sandboxed, windowsBash)(
  'never terminates a command that finishes inside its budget',
  () => {
    waitForMillisecond(750, 780);
    const result = runBudget(2, ['sleep', '1.4']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(!result.stdout.includes('exceeded its execution budget'));
  }
);

itUnless(sandboxed, windowsBash)(
  'still terminates a command that overruns its budget',
  () => {
    const result = runBudget(1, ['sleep', '20']);
    assert.equal(result.status, 124);
    assert.ok(result.stdout.includes('exceeded its execution budget'));
  }
);

// Use the native runner: test-anywhere currently drops per-test timeouts.
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';

const { test: nativeTest } = await import(
  process.versions.bun ? 'bun:test' : 'node:test'
);

export const REAL_GIT_TEST_TIMEOUT_MS = 60_000;
export const GIT_SCENARIO_TIMEOUT_MS = 45_000;
export const GIT_COMMAND_TIMEOUT_MS = 10_000;

export function testWithTimeout(name, run, timeout = REAL_GIT_TEST_TIMEOUT_MS) {
  return process.versions.bun
    ? nativeTest(name, run, timeout)
    : nativeTest(name, { timeout }, run);
}

export function spawnGitSync(args, options, spawn = spawnSync) {
  const result = spawn('git', args, {
    ...options,
    encoding: 'utf8',
    timeout: GIT_COMMAND_TIMEOUT_MS,
  });
  if (result.error) {
    const reason =
      result.error.code === 'ETIMEDOUT'
        ? `timed out after ${GIT_COMMAND_TIMEOUT_MS}ms`
        : result.error.message;
    throw new Error(
      `git ${args.join(' ')}: ${reason}\n${result.stdout || ''}${result.stderr || ''}`,
      { cause: result.error }
    );
  }
  return result;
}

export function runGitScenario(scenario, spawn = spawnSync) {
  // Keep many synchronous Git calls inside Node to avoid Bun subprocess issues.
  const scenarioPath = fileURLToPath(
    new URL('./issue-45-git-scenarios.mjs', import.meta.url)
  );
  const result = spawn('node', [scenarioPath, scenario], {
    encoding: 'utf8',
    timeout: GIT_SCENARIO_TIMEOUT_MS,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.error || result.status !== 0) {
    const reason =
      result.error?.code === 'ETIMEDOUT'
        ? `timed out after ${GIT_SCENARIO_TIMEOUT_MS}ms`
        : result.error?.message || `exited with status ${result.status}`;
    throw new Error(`Git scenario ${scenario}: ${reason}\n${output}`, {
      cause: result.error,
    });
  }
}

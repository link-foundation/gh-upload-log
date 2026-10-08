import {
  testWithTimeout as test,
  GIT_SCENARIO_TIMEOUT_MS,
} from '../experiments/real-git-test-utils.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';

test('issue #37 - real Git binary archives resume and reconstruct on the selected branch', () => {
  const scenario = fileURLToPath(
    new URL('../experiments/issue-37-git-roundtrip.mjs', import.meta.url)
  );
  const result = spawnSync('node', ['--max-old-space-size=128', scenario], {
    encoding: 'utf8',
    timeout: GIT_SCENARIO_TIMEOUT_MS,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import {
  GIT_SCENARIO_TIMEOUT_MS,
  testWithTimeout as test,
} from '../experiments/real-git-test-utils.mjs';

const fixture = fileURLToPath(
  new URL('../experiments/issue-67-bounded-upload.mjs', import.meta.url)
);

for (const mode of ['shared', 'target', 'dedicated', 'changed']) {
  test(`issue #67 - bounded verified text publication (${mode})`, () => {
    const result = spawnSync('node', [fixture, mode], {
      encoding: 'utf8',
      timeout: GIT_SCENARIO_TIMEOUT_MS,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
}

import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath, URL } from 'node:url';
import { testWithTimeout } from '../experiments/real-git-test-utils.mjs';

for (const mode of ['changeset', 'instant']) {
  testWithTimeout(
    `issue #61: ${mode} publication, install lag and original-SHA recovery`,
    () => {
      const result = spawnSync(
        process.execPath.includes('bun') ? 'node' : process.execPath,
        [
          fileURLToPath(
            new URL(
              '../experiments/issue-61-release-recovery.mjs',
              import.meta.url
            )
          ),
          mode,
        ],
        {
          encoding: 'utf8',
          timeout: 110_000,
          env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=128' },
        }
      );
      const output = `${result.stdout || ''}${result.stderr || ''}`;
      assert.equal(result.error, undefined, output);
      assert.equal(result.status, 0, output);
      assert.match(output, /"publishes":2/);
      assert.match(output, /"recoveredVersion":"1.1.0"/);
    },
    120_000
  );
}

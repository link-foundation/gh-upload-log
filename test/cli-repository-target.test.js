import { test } from 'test-anywhere';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));
function runCLI(args, env = {}, cwd) {
  return spawnSync('node', [cliPath, ...args], {
    cwd,
    env: {
      ...process.env,
      GH_UPLOAD_LOG_REPOSITORY: '',
      GH_UPLOAD_LOG_BRANCH: '',
      ...env,
    },
    encoding: 'utf8',
  });
}

test('CLI repository and branch support flags, environment, .lenv and precedence', () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'repository-target-cli-')
  );
  const filePath = path.join(directory, 'session.log');
  fs.writeFileSync(filePath, 'diagnostic\n');
  try {
    for (const [args, env] of [
      [
        [
          '--repository',
          'example-org/current-repo',
          '--branch',
          'feature/logs',
        ],
        {},
      ],
      [
        [],
        {
          GH_UPLOAD_LOG_REPOSITORY: 'example-org/current-repo',
          GH_UPLOAD_LOG_BRANCH: 'feature/logs',
        },
      ],
      [
        [
          '--repository',
          'example-org/current-repo',
          '--branch',
          'feature/logs',
        ],
        {
          GH_UPLOAD_LOG_REPOSITORY: 'other/repo',
          GH_UPLOAD_LOG_BRANCH: 'other',
        },
      ],
    ]) {
      const result = runCLI(
        [filePath, '--only-repository', '--dry-mode', '--verbose', ...args],
        env,
        directory
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Target: example-org\/current-repo/);
      assert.match(result.stdout, /Branch: feature\/logs/);
      assert.match(result.stdout, /existing repository visibility/);
    }
    fs.writeFileSync(
      path.join(directory, '.lenv'),
      'GH_UPLOAD_LOG_REPOSITORY: example-org/current-repo\nGH_UPLOAD_LOG_BRANCH: feature/logs\n'
    );
    const env = { ...process.env };
    delete env.GH_UPLOAD_LOG_REPOSITORY;
    delete env.GH_UPLOAD_LOG_BRANCH;
    const result = spawnSync(
      'node',
      [cliPath, filePath, '--only-repository', '--dry-mode', '--verbose'],
      { cwd: directory, env, encoding: 'utf8' }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Target: example-org\/current-repo/);
    assert.match(result.stdout, /Branch: feature\/logs/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI validates malformed repository and branch before file lookup', () => {
  for (const args of [
    ['--repository', 'bad-target'],
    ['--branch', 'feature/logs'],
    ['--repository', 'owner/repo', '--branch', 'bad..ref'],
  ]) {
    const result = runCLI(['missing.log', '--dry-mode', ...args]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /repository|branch/);
    assert.ok(!result.stdout.includes('Uploading'));
  }
});

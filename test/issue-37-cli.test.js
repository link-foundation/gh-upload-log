import { testWithTimeout as test } from '../experiments/real-git-test-utils.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
test('issue #37 - universal environment settings take precedence and .lenv accepts the new names', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-37-cli-'));
  const filePath = path.join(directory, 'data.bin');
  fs.writeFileSync(filePath, Buffer.from([0, 255]));
  const base = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith('GH_UPLOAD_')
    )
  );
  function run(args, env) {
    return spawnSync('node', [cli, filePath, ...args], {
      cwd: directory,
      env: { ...base, ...env },
      encoding: 'utf8',
      timeout: 10_000,
    });
  }
  try {
    let result = run([], {
      GH_UPLOAD_DRY_MODE: 'true',
      GH_UPLOAD_VERBOSE: 'true',
      GH_UPLOAD_PUBLIC: 'true',
      GH_UPLOAD_REPOSITORY: 'example-org/current-repo',
      GH_UPLOAD_LOG_REPOSITORY: 'legacy/repo',
      GH_UPLOAD_BRANCH: 'feature/files',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Target: example-org\/current-repo/);
    assert.match(result.stdout, /Branch: feature\/files/);
    assert.match(result.stdout, /Archive: gzip/);
    result = run(['--dry-mode', '--verbose'], {});
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Repository: private-logs/);
    result = run(['--dry-mode', '--verbose'], { GH_UPLOAD_PRIVATE: 'false' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Repository: public-logs/);
    result = run(['--dry-mode', '--verbose'], {
      GH_UPLOAD_LOG_PRIVATE: 'true',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Repository: private-logs/);
    result = run(['--only-gist', '--dry-mode'], {});
    assert.equal(result.status, 1);
    assert.match(result.stderr, /binary.*repository/i);
    result = run(['--public', '--private', '--dry-mode'], {});
    assert.equal(result.status, 1);
    assert.match(result.stderr, /mutually exclusive/);
    result = run(['--only-gist', '--only-repository', '--dry-mode'], {});
    assert.equal(result.status, 1);
    assert.match(result.stderr, /mutually exclusive/);
    fs.writeFileSync(
      path.join(directory, '.lenv'),
      'GH_UPLOAD_DRY_MODE: true\nGH_UPLOAD_VERBOSE: true\nGH_UPLOAD_PUBLIC: true\n'
    );
    result = run([], {});
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Repository: public-logs/);
    assert.match(result.stdout, /Archive: gzip/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

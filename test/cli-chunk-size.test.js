import { test } from 'test-anywhere';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));
function runCLI(args, env = {}) {
  return spawnSync('node', [cliPath, ...args], {
    env: { ...process.env, GH_UPLOAD_LOG_CHUNK_SIZE: '', ...env },
    encoding: 'utf8',
  });
}

test('CLI chunk-size flag and environment control repository dry-run planning', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chunk-size-cli-'));
  const filePath = path.join(directory, 'test.log');
  fs.writeFileSync(filePath, 'one\ntwo\ntri\nend\n');
  try {
    for (const [args, env] of [
      [['--chunk-size', '8B'], {}],
      [[], { GH_UPLOAD_LOG_CHUNK_SIZE: '8B' }],
      [['--chunk-size', '8B'], { GH_UPLOAD_LOG_CHUNK_SIZE: '4B' }],
    ]) {
      const result = runCLI(
        [filePath, '--only-repository', '--dry-mode', '--verbose', ...args],
        env
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /File count: 2/);
      assert.match(result.stdout, /chunkSize: 8/);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI rejects invalid, zero, unsafe and oversized chunk limits before upload', () => {
  for (const limit of ['bad', '0B', '3B', '101MB', '1GB']) {
    const result = runCLI(['missing.log', '--chunk-size', limit, '--dry-mode']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid --chunk-size value/);
    assert.ok(!result.stdout.includes('Uploading'));
  }
  const result = runCLI(['missing.log', '--dry-mode'], {
    GH_UPLOAD_LOG_CHUNK_SIZE: 'bad',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid --chunk-size value/);
});

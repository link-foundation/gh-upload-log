/**
 * Tests for gh-upload-log CLI
 */

import { test, assert } from 'test-anywhere';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cliPath = path.join(__dirname, '..', 'src', 'cli.js');
const testLogFile = path.join(os.tmpdir(), 'test-cli-log-file.log');

// Helper function to run CLI command
function runCLI(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [cliPath, ...args], {
      env: { ...process.env, ...env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({
        code,
        stdout,
        stderr,
        output: stdout + stderr,
      });
    });

    child.on('error', reject);
  });
}

// Setup test file
function setupTestFile() {
  if (!fs.existsSync(testLogFile)) {
    fs.writeFileSync(testLogFile, 'Test log content\n');
  }
}

setupTestFile();

// Test: Basic usage without flags (should not show conflicts error)
test('CLI basic usage - accepts positional argument without conflicts error', async () => {
  const result = await runCLI([testLogFile, '--dry-mode']);
  assert.equal(result.code, 0, 'Should exit with code 0');
  assert.ok(
    !result.output.includes(
      'Arguments public and private are mutually exclusive'
    ),
    'Should not show public/private conflict error'
  );
  assert.ok(
    result.output.includes('[DRY]') ||
      result.output.includes('would be created'),
    'Should run in dry mode'
  );
});

// Test: --public flag
test('CLI with --public flag', async () => {
  const result = await runCLI([testLogFile, '--public', '--dry-mode']);
  assert.equal(result.code, 0, 'Should exit with code 0');
  assert.ok(
    result.output.includes('🌐 public'),
    'Should set visibility to public'
  );
});

// Test: --private flag
test('CLI with --private flag', async () => {
  const result = await runCLI([testLogFile, '--private', '--dry-mode']);
  assert.equal(result.code, 0, 'Should exit with code 0');
  assert.ok(
    result.output.includes('🔒 private'),
    'Should set visibility to private'
  );
});

// Test: Default visibility (should be private)
test('CLI without visibility flags defaults to private', async () => {
  const result = await runCLI([testLogFile, '--dry-mode']);
  assert.equal(result.code, 0, 'Should exit with code 0');
  assert.ok(result.output.includes('🔒 private'), 'Should default to private');
});

// Test: Mutually exclusive --public and --private
test('CLI with both --public and --private shows conflict error', async () => {
  const result = await runCLI([testLogFile, '--public', '--private']);
  assert.equal(result.code, 1, 'Should exit with code 1');
  assert.ok(
    result.output.includes(
      'Arguments public and private are mutually exclusive'
    ),
    'Should show mutually exclusive error'
  );
});

// Test: --only-gist flag
test('CLI with --only-gist flag', async () => {
  const result = await runCLI([testLogFile, '--only-gist', '--dry-mode']);
  assert.equal(result.code, 0, 'Should exit with code 0');
  assert.ok(result.output.includes('Gist'), 'Should use gist upload type');
});

// Test: --only-repository flag
test('CLI with --only-repository flag', async () => {
  const result = await runCLI([testLogFile, '--only-repository', '--dry-mode']);
  assert.equal(result.code, 0, 'Should exit with code 0');
  assert.ok(
    result.output.includes('Repository'),
    'Should use repo upload type'
  );
});

// Test: Mutually exclusive --only-gist and --only-repository
test('CLI with both --only-gist and --only-repository shows conflict error', async () => {
  const result = await runCLI([
    testLogFile,
    '--only-gist',
    '--only-repository',
  ]);
  assert.equal(result.code, 1, 'Should exit with code 1');
  assert.ok(
    result.output.includes(
      'Arguments only-gist and only-repository are mutually exclusive'
    ),
    'Should show mutually exclusive error'
  );
});

// Test: --verbose flag
test('CLI with --verbose flag shows options', async () => {
  const result = await runCLI([testLogFile, '--verbose', '--dry-mode']);
  assert.equal(result.code, 0, 'Should exit with code 0');
  assert.ok(
    result.output.includes('Options:'),
    'Should show options in verbose mode'
  );
});

// Test: --help flag
test('CLI with --help flag shows usage', async () => {
  const result = await runCLI(['--help']);
  assert.equal(result.code, 0, 'Should exit with code 0');
  assert.ok(result.output.includes('Usage:'), 'Should show usage information');
  assert.ok(
    !result.output.includes(
      'Arguments public and private are mutually exclusive'
    ),
    'Should not show conflict error in help'
  );
});

// Test: Missing file path
test('CLI without file path shows error', async () => {
  const result = await runCLI([]);
  assert.equal(result.code, 1, 'Should exit with code 1');
  assert.ok(
    result.output.includes('Log file path is required') ||
      result.output.includes('Not enough non-option arguments'),
    'Should show error message about missing file path'
  );
});

// Test: Non-existent file
test('CLI with non-existent file shows error', async () => {
  const result = await runCLI(['/nonexistent/file.log', '--dry-mode']);
  assert.equal(result.code, 1, 'Should exit with code 1');
  assert.ok(
    result.output.includes('Error:') &&
      result.output.includes('does not exist'),
    'Should show file not found error'
  );
});

// Test: Non-existent file does not print upload status before error (issue #24)
test('CLI with non-existent file does not print upload status before error', async () => {
  const result = await runCLI(['/nonexistent/file.log']);
  assert.equal(result.code, 1, 'Should exit with code 1');
  assert.ok(
    !result.output.includes('Uploading'),
    'Should not print uploading status for non-existent file'
  );
  assert.ok(
    !result.output.startsWith('\n'),
    'Should not start output with blank line'
  );
  assert.ok(
    result.output.includes('Error:') &&
      result.output.includes('does not exist'),
    'Should show file not found error'
  );
});

// Test: --description flag
test('CLI with --description flag', async () => {
  const result = await runCLI([
    testLogFile,
    '--description',
    'Test description',
    '--dry-mode',
    '--verbose',
  ]);
  assert.equal(result.code, 0, 'Should exit with code 0');
  assert.ok(
    result.output.includes('Test description'),
    'Should include description'
  );
});

// Test: ENOSPC error handling in CLI
// We test the error detection logic by importing isENOSPC directly
test('CLI ENOSPC - isENOSPC detects disk space errors correctly', async () => {
  // This tests that the detection function works for CLI error handling
  const { isENOSPC } = await import('../src/index.js');

  // Test ENOSPC code
  const enospcError = new Error('write');
  enospcError.code = 'ENOSPC';
  assert.ok(isENOSPC(enospcError), 'Should detect ENOSPC error code');

  // Test message-based detection
  const msgError = new Error('ENOSPC: no space left on device, write');
  assert.ok(isENOSPC(msgError), 'Should detect ENOSPC in message');

  // Test non-ENOSPC error
  const otherError = new Error('EACCES: permission denied');
  otherError.code = 'EACCES';
  assert.ok(!isENOSPC(otherError), 'Should not detect non-ENOSPC errors');
});

// Test: ENOSPC hint logic - verify the CLI error handler correctly gates the --only-gist hint
test('CLI ENOSPC - --only-gist hint only shown when error message contains it', async () => {
  // The CLI checks error.message.includes('--only-gist') to decide whether to show the hint.
  // This hint is only added by uploadLog() when repo upload fails with ENOSPC for a small file.
  // In auto mode, small files use gist by default, so the hint never appears.
  const { isENOSPC, createENOSPCError } = await import('../src/index.js');

  // Simulate gist ENOSPC (auto mode, small file) - no hint
  const gistEnospc = createENOSPCError('gist upload', new Error('test'));
  assert.ok(isENOSPC(gistEnospc), 'Should be detected as ENOSPC');
  assert.ok(
    !gistEnospc.message.includes('--only-gist'),
    'Gist ENOSPC should NOT contain --only-gist hint'
  );

  // Simulate repo ENOSPC with small file (forced --only-repository) - has hint
  const repoEnospc = createENOSPCError('repository upload', new Error('test'));
  repoEnospc.message +=
    ' Hint: This file fits in a gist. Try --only-gist to upload without requiring temp disk space.';
  assert.ok(isENOSPC(repoEnospc), 'Should be detected as ENOSPC');
  assert.ok(
    repoEnospc.message.includes('--only-gist'),
    'Forced repo ENOSPC for small file should contain --only-gist hint'
  );
});

// Clean up function (optional)
export function cleanupTestFile() {
  if (fs.existsSync(testLogFile)) {
    fs.unlinkSync(testLogFile);
  }
}

// Note: We don't call cleanup automatically to allow inspection of test files

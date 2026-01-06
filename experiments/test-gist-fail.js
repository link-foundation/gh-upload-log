#!/usr/bin/env bun

/**
 * Experiment to understand gist creation failure behavior
 */

import fs from 'node:fs';

const { $ } = await import('command-stream');

console.log('=== Testing gist creation failure scenarios ===\n');

// Create a small test file
const testFile = '/tmp/test-gist-fail.txt';
fs.writeFileSync(testFile, 'Test content\n');

// Test 1: Check what happens with gh gist create on success
console.log('Test 1: Successful gist creation (small file)');
try {
  const result = await $`gh gist create ${testFile} --desc "test"`;
  console.log('  stdout:', JSON.stringify(result.stdout));
  console.log('  stderr:', JSON.stringify(result.stderr));
  console.log('  exitCode:', result.exitCode);
  console.log('  URL extracted:', result.stdout.trim());

  // Check if URL is valid
  const url = result.stdout.trim();
  if (url && url.startsWith('https://')) {
    console.log('  SUCCESS: Valid URL returned');
    // Clean up
    const gistId = url.split('/').pop();
    await $`gh gist delete ${gistId} --yes`;
    console.log('  Cleaned up test gist');
  } else {
    console.log('  WARNING: No valid URL in stdout');
  }
} catch (err) {
  console.log('  Error caught:', err.message);
}

// Test 2: Check what gist command outputs on error (simulate with invalid token)
console.log('\nTest 2: What does gh gist create return on HTTP error?');
console.log(
  '  We cannot easily simulate HTTP 502, but we can check stderr handling'
);

// Test 3: Check if empty stdout is returned on failure
console.log('\nTest 3: URL validation logic');
const testUrls = [
  'https://gist.github.com/abc123',
  '',
  '   ',
  'error message',
  'https://gist.github.com/',
];
for (const url of testUrls) {
  const trimmed = url.trim();
  const isValid =
    trimmed &&
    trimmed.startsWith('https://gist.github.com/') &&
    trimmed.length > 'https://gist.github.com/'.length;
  console.log(`  "${url}" -> valid: ${isValid}`);
}

// Clean up
fs.unlinkSync(testFile);
console.log('\n=== End of tests ===');

#!/usr/bin/env bun

/**
 * End-to-end test to verify the fix works properly
 */

import fs from 'node:fs';
import { uploadLog, formatFileSize, getFileSize } from '../src/index.js';

// Create a test file similar to the one in the issue (about 1.9KB)
const testFile = '/tmp/test-fix-e2e.log';
const content = 'Test log content for verifying the fix\n'.repeat(50);
fs.writeFileSync(testFile, content);

console.log('=== Testing the fix for issue #13 ===\n');

// Test 1: formatFileSize
console.log('Test 1: formatFileSize');
const fileSize = getFileSize(testFile);
console.log(`  File size in bytes: ${fileSize}`);
console.log(`  Formatted: ${formatFileSize(fileSize)}`);
console.log(`  Expected: should show KB, not 0.00 MB`);
console.log('');

// Test 2: Upload as gist (private by default)
console.log('Test 2: Upload as private gist');
try {
  const result = await uploadLog({
    filePath: testFile,
    isPublic: false, // private gist
    verbose: true,
  });
  console.log('Result:', result);
  console.log('');
  console.log('SUCCESS: URL captured correctly:', result.url);

  // Cleanup - delete the test gist
  if (result.url && result.url.includes('gist.github.com')) {
    const gistId = result.url.split('/').pop();
    console.log('\nCleaning up: deleting test gist', gistId);
    const { $ } = await import('command-stream');
    await $`gh gist delete ${gistId}`;
    console.log('Test gist deleted');
  }
} catch (error) {
  console.error('ERROR:', error.message);
}

// Cleanup test file
fs.unlinkSync(testFile);
console.log('\nTest file cleaned up');

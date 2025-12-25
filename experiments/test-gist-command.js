#!/usr/bin/env bun

/**
 * Experiment to test the gist command and understand the issue
 */

import fs from 'node:fs';

// Create a test file
const testFile = '/tmp/test-gh-upload-log.log';
fs.writeFileSync(
  testFile,
  'Test content for gist upload experiment\n'.repeat(10)
);

console.log('Test file created:', testFile);
console.log('File size:', fs.statSync(testFile).size, 'bytes');

// Test 1: Test the gh gist create command directly
console.log('\n--- Testing gh gist create command ---');

const { $ } = await import('command-stream');

// The problem: when visibility is empty string, it causes issues
const visibility = ''; // This is what happens when isPublic = false
const desc = 'Test description';

console.log('\nTest A: Original command pattern (problematic)');
console.log(`Command: gh gist create ${testFile} ${visibility} --desc ${desc}`);

try {
  // This pattern is problematic because empty string still gets interpolated
  const result =
    await $`gh gist create ${testFile} ${visibility} --desc ${desc}`;
  console.log('stdout:', JSON.stringify(result.stdout));
  console.log('stderr:', JSON.stringify(result.stderr));
  console.log('URL:', result.stdout.trim());
} catch (err) {
  console.log('Error:', err.message);
}

// Cleanup - delete the gist if created
console.log('\n--- Cleanup ---');
console.log('Please delete any test gists manually if created');
console.log('Test file:', testFile);

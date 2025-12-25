#!/usr/bin/env bun

/**
 * Experiment to understand how command-stream handles empty strings
 */

const { $ } = await import('command-stream');

console.log('--- Test 1: Empty string interpolation ---');
try {
  const empty = '';
  const result = await $`echo "hello" ${empty} world`;
  console.log('Result:', result.stdout);
} catch (err) {
  console.log('Error:', err.message);
}

console.log('\n--- Test 2: Using array for conditional arguments ---');
try {
  const args = ['--public']; // or [] for private
  const result = await $`echo "args:" ${args}`;
  console.log('Result:', result.stdout);
} catch (err) {
  console.log('Error:', err.message);
}

console.log('\n--- Test 3: Direct gh gist create without visibility flag ---');
const testFile = '/tmp/test-gh-upload-log.log';
import fs from 'node:fs';
fs.writeFileSync(testFile, 'Test content\n');

try {
  // Try without the visibility flag for private (default behavior)
  const desc = 'Test description';
  const result = await $`gh gist create ${testFile} --desc ${desc}`;
  console.log('stdout:', result.stdout);
  console.log('URL:', result.stdout.trim());
} catch (err) {
  console.log('Error:', err.message);
}

console.log('\n--- Test 4: Using conditional spread with array ---');
try {
  const isPublic = false;
  const conditionalArgs = isPublic ? ['--public'] : [];
  const conditionalDesc = 'Test description conditional';

  // This approach may not work with template literals
  console.log(
    'Would need to build command differently...',
    conditionalArgs,
    conditionalDesc
  );
} catch (err) {
  console.log('Error:', err.message);
}

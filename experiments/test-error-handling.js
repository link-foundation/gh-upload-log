#!/usr/bin/env bun

/**
 * Experiment to understand how command-stream handles errors
 * when gh gist create fails
 */

const { $ } = await import('command-stream');

console.log('=== Testing command-stream error handling ===\n');

// Test 1: Command that succeeds
console.log('Test 1: Successful command');
try {
  const result = await $`echo "hello"`;
  console.log('  stdout:', JSON.stringify(result.stdout));
  console.log('  stderr:', JSON.stringify(result.stderr));
  console.log('  exitCode:', result.exitCode);
  console.log('');
} catch (err) {
  console.log('  Error:', err.message);
  console.log('');
}

// Test 2: Command that fails (non-existent command)
console.log('Test 2: Non-existent command');
try {
  const result = await $`nonexistent-command-xyz`;
  console.log('  stdout:', JSON.stringify(result.stdout));
  console.log('  stderr:', JSON.stringify(result.stderr));
  console.log('  exitCode:', result.exitCode);
  console.log('');
} catch (err) {
  console.log('  Error caught:', err.message);
  console.log('  Error exitCode:', err.exitCode);
  console.log('');
}

// Test 3: Command that returns non-zero exit code
console.log('Test 3: Command with non-zero exit code');
try {
  const result = await $`sh -c "exit 1"`;
  console.log('  stdout:', JSON.stringify(result.stdout));
  console.log('  stderr:', JSON.stringify(result.stderr));
  console.log('  exitCode:', result.exitCode);
  console.log('');
} catch (err) {
  console.log('  Error caught:', err.message);
  console.log('  Error exitCode:', err.exitCode);
  console.log('');
}

// Test 4: gh command that fails (simulating HTTP error)
console.log('Test 4: gh api with invalid endpoint');
try {
  const result = await $`gh api /nonexistent-endpoint-xyz`;
  console.log('  stdout:', JSON.stringify(result.stdout));
  console.log('  stderr:', JSON.stringify(result.stderr));
  console.log('  exitCode:', result.exitCode);
  console.log('');
} catch (err) {
  console.log('  Error caught:', err.message);
  console.log('  Error exitCode:', err.exitCode);
  console.log('  Error stderr:', err.stderr);
  console.log('');
}

console.log('=== End of error handling tests ===');

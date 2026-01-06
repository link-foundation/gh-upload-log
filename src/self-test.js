#!/usr/bin/env bun

/**
 * Self-test module for gh-upload-log
 *
 * Runs end-to-end tests to verify the upload functionality works correctly
 * on the user's machine with their GitHub authentication.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  uploadLog,
  formatFileSize,
  determineUploadStrategy,
  GITHUB_GIST_FILE_LIMIT,
  GITHUB_REPO_CHUNK_SIZE,
} from './index.js';

const { $ } = await import('command-stream');

/**
 * Generate a test file of the specified size
 *
 * @param {number} sizeMB - Target size in MB
 * @param {string} outputPath - Output file path
 */
function generateTestFile(sizeMB, outputPath) {
  const lineTemplate =
    '[2025-01-07T12:00:00.000Z] INFO  Test log entry - Lorem ipsum dolor sit amet.\n';
  const lineSize = lineTemplate.length;
  const targetBytes = sizeMB * 1024 * 1024;
  const linesNeeded = Math.ceil(targetBytes / lineSize);

  const fd = fs.openSync(outputPath, 'w');
  const chunkLines = 10000;

  let lineNumber = 0;
  while (lineNumber < linesNeeded) {
    const lines = [];
    for (let i = 0; i < chunkLines && lineNumber < linesNeeded; i++) {
      lineNumber++;
      lines.push(lineTemplate);
    }
    fs.writeSync(fd, lines.join(''));
  }

  fs.closeSync(fd);
  return fs.statSync(outputPath).size;
}

/**
 * Clean up a gist by ID
 *
 * @param {string} gistId - Gist ID to delete
 */
async function cleanupGist(gistId) {
  try {
    await $`gh gist delete ${gistId} --yes`;
    return true;
  } catch {
    return false;
  }
}

/**
 * Clean up a repository
 *
 * @param {string} repoName - Repository name to delete
 */
async function cleanupRepo(repoName) {
  try {
    await $`gh repo delete ${repoName} --yes`;
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a single test case
 *
 * @param {Object} testCase - Test case configuration
 * @returns {Object} Test result
 */
async function runTest(testCase) {
  const { name, sizeMB, mode, expectedType, cleanup = true } = testCase;

  const testDir = '/tmp/gh-upload-log-selftest';
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  const testFile = path.join(testDir, `test-${sizeMB}mb-${Date.now()}.log`);

  try {
    // Generate test file
    console.log(`  📝 Generating ${sizeMB}MB test file...`);
    const actualSize = generateTestFile(sizeMB, testFile);

    // Run strategy detection
    const strategy = determineUploadStrategy(testFile);
    console.log(`  📊 Strategy: ${strategy.type} (${strategy.reason})`);

    if (expectedType && strategy.type !== expectedType) {
      return {
        name,
        passed: false,
        error: `Expected strategy type '${expectedType}', got '${strategy.type}'`,
      };
    }

    // Run upload
    console.log(`  ⏳ Uploading as ${mode || 'auto'}...`);
    const options = {
      filePath: testFile,
      isPublic: false, // Always private for tests
      verbose: false,
    };

    if (mode === 'gist') {
      options.onlyGist = true;
    } else if (mode === 'repo') {
      options.onlyRepository = true;
    }

    const result = await uploadLog(options);

    // Validate result
    if (!result.url || !result.url.startsWith('https://')) {
      return {
        name,
        passed: false,
        error: `Invalid URL returned: ${result.url}`,
      };
    }

    console.log(`  ✅ Success: ${result.url}`);

    // Cleanup
    if (cleanup) {
      console.log(`  🧹 Cleaning up...`);
      if (result.type === 'gist') {
        const gistId = result.url.split('/').pop();
        await cleanupGist(gistId);
      } else if (result.type === 'repo') {
        await cleanupRepo(result.repositoryName);
      }
    }

    // Cleanup test file
    fs.unlinkSync(testFile);

    return {
      name,
      passed: true,
      url: result.url,
      type: result.type,
      actualSize: formatFileSize(actualSize),
    };
  } catch (error) {
    // Cleanup test file on error
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }

    return {
      name,
      passed: false,
      error: error.message,
    };
  }
}

/**
 * Run the self-test suite
 *
 * @param {Object} options - Test options
 * @returns {Object} Test results
 */
export async function runSelfTest(options = {}) {
  const { verbose = false, quick = false } = options;

  console.log('');
  console.log('🧪 gh-upload-log Self-Test');
  console.log('==========================');
  console.log('');

  // Display current limits
  console.log('📋 Current Configuration:');
  console.log(`  • Gist limit: ${formatFileSize(GITHUB_GIST_FILE_LIMIT)}`);
  console.log(`  • Repo chunk size: ${formatFileSize(GITHUB_REPO_CHUNK_SIZE)}`);
  console.log('');

  // Check gh CLI authentication
  console.log('🔐 Checking GitHub authentication...');
  try {
    const authResult = await $`gh auth status`;
    console.log('  ✅ Authenticated');
    if (verbose) {
      console.log(authResult.stderr);
    }
  } catch {
    console.log('  ❌ Not authenticated. Please run: gh auth login');
    return { passed: false, tests: [], error: 'Not authenticated' };
  }
  console.log('');

  // Define test cases
  const testCases = quick
    ? [{ name: 'Small gist (1MB)', sizeMB: 1, expectedType: 'gist' }]
    : [
        { name: 'Tiny gist (1MB)', sizeMB: 1, expectedType: 'gist' },
        { name: 'Medium gist (10MB)', sizeMB: 10, expectedType: 'gist' },
        { name: 'Max gist (24MB)', sizeMB: 24, expectedType: 'gist' },
      ];

  const results = [];

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    console.log(`Test ${i + 1}/${testCases.length}: ${testCase.name}`);
    const result = await runTest(testCase);
    results.push(result);

    if (result.passed) {
      console.log(`  ✅ PASSED`);
    } else {
      console.log(`  ❌ FAILED: ${result.error}`);
    }
    console.log('');
  }

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log('📊 Summary');
  console.log('----------');
  console.log(`  Passed: ${passed}/${results.length}`);
  console.log(`  Failed: ${failed}/${results.length}`);
  console.log('');

  if (failed === 0) {
    console.log('✅ All tests passed!');
  } else {
    console.log('❌ Some tests failed. Check the output above for details.');
  }

  return {
    passed: failed === 0,
    tests: results,
    summary: { passed, failed, total: results.length },
  };
}

// CLI support
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const quick = args.includes('--quick') || args.includes('-q');
  const verbose = args.includes('--verbose') || args.includes('-v');

  runSelfTest({ quick, verbose })
    .then((result) => {
      process.exit(result.passed ? 0 : 1);
    })
    .catch((error) => {
      console.error('❌ Test suite error:', error.message);
      process.exit(1);
    });
}

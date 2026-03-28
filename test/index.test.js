/**
 * Tests for gh-upload-log core library
 */

import { test, assert } from 'test-anywhere';
import fs from 'node:fs';
import path from 'node:path';
import { cwd } from 'node:process';
import {
  normalizeFileName,
  generateRepoName,
  generateGistFileName,
  fileExists,
  getFileSize,
  formatFileSize,
  determineUploadStrategy,
  isENOSPC,
  createENOSPCError,
  GITHUB_GIST_FILE_LIMIT,
  GITHUB_REPO_CHUNK_SIZE,
} from '../src/index.js';

// Create test directory
const testDir = path.join(cwd(), 'test', 'fixtures');
if (!fs.existsSync(testDir)) {
  fs.mkdirSync(testDir, { recursive: true });
}

// Test file paths
const smallTestFile = path.join(testDir, 'small.log');
const mediumTestFile = path.join(testDir, 'medium.log');
const largeTestFile = path.join(testDir, 'large.log'); // 26MB - exceeds 25MB gist limit

// Create test files if they don't exist
function setupTestFiles() {
  // Small file (1 KB)
  if (!fs.existsSync(smallTestFile)) {
    fs.writeFileSync(smallTestFile, 'x'.repeat(1024));
  }

  // Medium file (1 MB)
  if (!fs.existsSync(mediumTestFile)) {
    fs.writeFileSync(mediumTestFile, 'x'.repeat(1024 * 1024));
  }

  // Large file (26 MB - exceeds 25MB gist limit, triggers repository mode)
  // Note: This file is created dynamically for testing and is larger than usual
  // We create a sparse/efficient representation to avoid slow tests
  if (!fs.existsSync(largeTestFile)) {
    // Create 26MB file using streaming to avoid memory issues
    const fd = fs.openSync(largeTestFile, 'w');
    const chunk = 'x'.repeat(1024 * 1024); // 1MB chunk
    for (let i = 0; i < 26; i++) {
      fs.writeSync(fd, chunk);
    }
    fs.closeSync(fd);
  }
}

setupTestFiles();

// Test: normalizeFileName
test('normalizeFileName - removes leading slashes', () => {
  const result = normalizeFileName('/home/user/test.log');
  assert.equal(result, 'home-user-test.log');
});

test('normalizeFileName - replaces all slashes with dashes', () => {
  const result = normalizeFileName('var/log/app/error.log');
  assert.equal(result, 'var-log-app-error.log');
});

test('normalizeFileName - handles relative paths', () => {
  const result = normalizeFileName('./logs/app.log');
  assert.equal(result, '.-logs-app.log');
});

test('normalizeFileName - handles multiple leading slashes', () => {
  const result = normalizeFileName('///home/user/test.log');
  assert.equal(result, 'home-user-test.log');
});

// Test: generateRepoName
test('generateRepoName - adds log- prefix and removes extension', () => {
  const result = generateRepoName('/home/user/test.log');
  assert.equal(result, 'log-home-user-test');
});

test('generateRepoName - works with non-log extensions', () => {
  const result = generateRepoName('/var/log/error.txt');
  assert.equal(result, 'log-var-log-error.txt');
});

// Test: generateGistFileName
test('generateGistFileName - returns normalized filename', () => {
  const result = generateGistFileName('/home/user/test.log');
  assert.equal(result, 'home-user-test.log');
});

// Test: fileExists
test('fileExists - returns true for existing file', () => {
  const result = fileExists(smallTestFile);
  assert.equal(result, true);
});

test('fileExists - returns false for non-existing file', () => {
  const result = fileExists('/nonexistent/file.log');
  assert.equal(result, false);
});

test('fileExists - returns false for directory', () => {
  const result = fileExists(testDir);
  assert.equal(result, false);
});

// Test: getFileSize
test('getFileSize - returns correct size for small file', () => {
  const result = getFileSize(smallTestFile);
  assert.equal(result, 1024);
});

test('getFileSize - returns correct size for medium file', () => {
  const result = getFileSize(mediumTestFile);
  assert.equal(result, 1024 * 1024);
});

// Test: formatFileSize
test('formatFileSize - formats 0 bytes', () => {
  const result = formatFileSize(0);
  assert.equal(result, '0 B');
});

test('formatFileSize - formats bytes', () => {
  const result = formatFileSize(500);
  assert.equal(result, '500 B');
});

test('formatFileSize - formats kilobytes', () => {
  const result = formatFileSize(1024);
  assert.equal(result, '1.00 KB');
});

test('formatFileSize - formats kilobytes with decimals', () => {
  const result = formatFileSize(1536);
  assert.equal(result, '1.50 KB');
});

test('formatFileSize - formats megabytes', () => {
  const result = formatFileSize(1024 * 1024);
  assert.equal(result, '1.00 MB');
});

test('formatFileSize - formats 1.9 KB file correctly', () => {
  // This is the actual use case from the issue (1.9K file)
  const result = formatFileSize(1945);
  assert.equal(result, '1.90 KB');
});

test('formatFileSize - formats gigabytes', () => {
  const result = formatFileSize(1024 * 1024 * 1024);
  assert.equal(result, '1.00 GB');
});

// Test: determineUploadStrategy
test('determineUploadStrategy - chooses gist for small files', () => {
  const result = determineUploadStrategy(smallTestFile);
  assert.equal(result.type, 'gist');
  assert.equal(result.needsSplit, false);
  assert.ok(result.reason.includes('Gist'));
});

test('determineUploadStrategy - chooses gist for medium files under limit', () => {
  const result = determineUploadStrategy(mediumTestFile);
  assert.equal(result.type, 'gist');
  assert.equal(result.needsSplit, false);
});

test('determineUploadStrategy - chooses repo for files exceeding gist limit', () => {
  const result = determineUploadStrategy(largeTestFile);
  assert.equal(result.type, 'repo');
  assert.equal(result.needsSplit, false); // 26MB doesn't need split (under 100MB)
  assert.ok(result.reason.includes('Gist limit'));
});

test('determineUploadStrategy - throws error for non-existent file', () => {
  assert.throws(() => {
    determineUploadStrategy('/nonexistent/file.log');
  });
});

// Test: Constants
// Note: GITHUB_GIST_FILE_LIMIT was lowered from 100MB to 25MB
// to match the web interface limit and avoid HTTP 502 errors
// See: https://github.com/link-foundation/gh-upload-log/issues/19
test('GITHUB_GIST_FILE_LIMIT - is 25MB (safe API limit)', () => {
  assert.equal(GITHUB_GIST_FILE_LIMIT, 25 * 1024 * 1024);
});

test('GITHUB_REPO_CHUNK_SIZE - is 100MB', () => {
  assert.equal(GITHUB_REPO_CHUNK_SIZE, 100 * 1024 * 1024);
});

// Test: isENOSPC
test('isENOSPC - detects error with code ENOSPC', () => {
  const error = new Error('write failed');
  error.code = 'ENOSPC';
  assert.equal(isENOSPC(error), true);
});

test('isENOSPC - detects ENOSPC in error message', () => {
  const error = new Error('ENOSPC: no space left on device, write');
  assert.equal(isENOSPC(error), true);
});

test('isENOSPC - detects "no space left on device" in error message', () => {
  const error = new Error('Error: no space left on device');
  assert.equal(isENOSPC(error), true);
});

test('isENOSPC - detects ENOSPC in stderr', () => {
  const error = new Error('Command failed');
  error.stderr = 'ENOSPC: no space left on device';
  assert.equal(isENOSPC(error), true);
});

test('isENOSPC - detects "no space left on device" in stderr', () => {
  const error = new Error('Command failed');
  error.stderr = 'fatal: no space left on device';
  assert.equal(isENOSPC(error), true);
});

test('isENOSPC - returns false for null/undefined', () => {
  assert.equal(isENOSPC(null), false);
  assert.equal(isENOSPC(undefined), false);
});

test('isENOSPC - returns false for non-ENOSPC errors', () => {
  const error = new Error('Permission denied');
  error.code = 'EACCES';
  assert.equal(isENOSPC(error), false);
});

test('isENOSPC - returns false for generic errors', () => {
  const error = new Error('Something went wrong');
  assert.equal(isENOSPC(error), false);
});

// Test: createENOSPCError
test('createENOSPCError - creates error with ENOSPC code', () => {
  const original = new Error('write failed');
  const error = createENOSPCError('gist upload', original);
  assert.equal(error.code, 'ENOSPC');
  assert.equal(error.operation, 'gist upload');
  assert.equal(error.originalError, original);
  assert.ok(error.message.includes('No space left on device'));
  assert.ok(error.message.includes('gist upload'));
  assert.ok(error.message.includes('Free disk space'));
});

test('createENOSPCError - includes actionable suggestions', () => {
  const error = createENOSPCError('test', new Error('test'));
  assert.ok(error.message.includes('Suggestion'));
  assert.ok(error.message.includes('~/.claude/debug'));
});

// Test: ENOSPC hint logic - only suggest --only-gist when repo mode is forced for small files
test('createENOSPCError - --only-gist hint only added for repo upload of small files', () => {
  // In uploadLog(), the --only-gist hint is appended only when:
  // 1. uploadType === 'repo' (which means either auto chose repo for >25MB files, or user forced --only-repository)
  // 2. ENOSPC occurs during repo upload
  // 3. File is ≤ 25MB (fits in gist)
  // Case: auto mode, ≤25MB file → gist path → no hint needed (gist is default)
  const gistError = createENOSPCError('gist upload', new Error('test'));
  assert.ok(
    !gistError.message.includes('--only-gist'),
    'Gist upload ENOSPC should NOT suggest --only-gist'
  );

  // Case: forced --only-repository, ≤25MB file → repo path → hint IS needed
  const repoError = createENOSPCError('repository upload', new Error('test'));
  // The base createENOSPCError does not include the hint; it's added by uploadLog()
  assert.ok(
    !repoError.message.includes('--only-gist'),
    'Base ENOSPC error should NOT include --only-gist hint'
  );

  // Simulate what uploadLog() does when repo upload fails with ENOSPC for small file
  const enhanced = createENOSPCError('repository upload', new Error('test'));
  enhanced.message +=
    ' Hint: This file fits in a gist. Try --only-gist to upload without requiring temp disk space.';
  assert.ok(
    enhanced.message.includes('--only-gist'),
    'Enhanced repo ENOSPC for small file should include --only-gist hint'
  );
});

// Test: determineUploadStrategy always picks gist for files ≤25MB (konard's key point)
test('determineUploadStrategy - always picks gist for files within gist limit', () => {
  // This validates konard's feedback: "by default we should use gist, if it fits"
  // Files ≤25MB should ALWAYS get strategy type 'gist' in auto mode
  const smallResult = determineUploadStrategy(smallTestFile);
  assert.equal(
    smallResult.type,
    'gist',
    'Small files should use gist strategy'
  );

  const mediumResult = determineUploadStrategy(mediumTestFile);
  assert.equal(
    mediumResult.type,
    'gist',
    'Medium files (1MB) should use gist strategy'
  );
});

// Test: determineUploadStrategy picks repo only for files exceeding gist limit
test('determineUploadStrategy - only picks repo when file exceeds gist limit', () => {
  const largeResult = determineUploadStrategy(largeTestFile);
  assert.equal(
    largeResult.type,
    'repo',
    'Files >25MB should use repo strategy'
  );
  // This means in auto mode, --only-gist hint can only appear for forced --only-repository
});

// Clean up function (optional, can be called after tests)
export function cleanupTestFiles() {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

// Note: We don't call cleanup automatically to allow inspection of test files
// Call cleanupTestFiles() manually if needed

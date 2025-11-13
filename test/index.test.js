/**
 * Tests for gh-upload-log core library
 */

import { test, assert } from 'test-anywhere';
import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeFileName,
  generateRepoName,
  generateGistFileName,
  fileExists,
  getFileSize,
  determineUploadStrategy,
  GITHUB_GIST_FILE_LIMIT,
  GITHUB_REPO_CHUNK_SIZE
} from '../src/index.js';

// Create test directory
const testDir = path.join(process.cwd(), 'test', 'fixtures');
if (!fs.existsSync(testDir)) {
  fs.mkdirSync(testDir, { recursive: true });
}

// Test file paths
const smallTestFile = path.join(testDir, 'small.log');
const mediumTestFile = path.join(testDir, 'medium.log');

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

test('determineUploadStrategy - throws error for non-existent file', () => {
  assert.throws(() => {
    determineUploadStrategy('/nonexistent/file.log');
  });
});

// Test: Constants
test('GITHUB_GIST_FILE_LIMIT - is 100MB', () => {
  assert.equal(GITHUB_GIST_FILE_LIMIT, 100 * 1024 * 1024);
});

test('GITHUB_REPO_CHUNK_SIZE - is 100MB', () => {
  assert.equal(GITHUB_REPO_CHUNK_SIZE, 100 * 1024 * 1024);
});

// Clean up function (optional, can be called after tests)
function cleanupTestFiles() {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

// Note: We don't call cleanup automatically to allow inspection of test files
// Call cleanupTestFiles() manually if needed

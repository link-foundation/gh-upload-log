#!/usr/bin/env bun

/**
 * Example: Using the library API functions
 */

import {
  normalizeFileName,
  generateRepoName,
  generateGistFileName,
  GITHUB_GIST_FILE_LIMIT,
  GITHUB_REPO_CHUNK_SIZE,
} from '../src/index.js';

console.log('=== gh-upload-log Library API Examples ===\n');

// Example 1: Normalize file names
console.log('1. Normalize file names:');
console.log('  Input: /home/user/logs/app.log');
console.log('  Output:', normalizeFileName('/home/user/logs/app.log'));
console.log('');

// Example 2: Generate repository name
console.log('2. Generate repository name:');
console.log('  Input: /var/log/system.log');
console.log('  Output:', generateRepoName('/var/log/system.log'));
console.log('');

// Example 3: Generate gist file name
console.log('3. Generate gist file name:');
console.log('  Input: ./logs/error.log');
console.log('  Output:', generateGistFileName('./logs/error.log'));
console.log('');

// Example 4: Show constants
console.log('4. GitHub limits:');
console.log(`  Gist file limit: ${GITHUB_GIST_FILE_LIMIT / (1024 * 1024)} MB`);
console.log(`  Repo chunk size: ${GITHUB_REPO_CHUNK_SIZE / (1024 * 1024)} MB`);
console.log('');

// Example 5: Determine upload strategy (with fake file sizes)
console.log('5. Upload strategy examples:');

// Simulate a small file
console.log('  Small file (1 MB):');
console.log('    -> Would use: gist');
console.log('');

// Simulate a large file
console.log('  Large file (500 MB):');
const numChunks = Math.ceil((500 * 1024 * 1024) / GITHUB_REPO_CHUNK_SIZE);
console.log(`    -> Would use: repo (split into ${numChunks} chunks)`);
console.log('');

console.log('=== End of examples ===');

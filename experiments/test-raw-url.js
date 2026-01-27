#!/usr/bin/env bun

/**
 * Test script for verifying raw URL functionality (issue #21)
 *
 * This script tests:
 * 1. Gist creation returns raw URL for single file
 * 2. Repository creation returns raw URL for single file
 * 3. Raw URLs are accessible without authentication
 *
 * Usage:
 *   bun experiments/test-raw-url.js
 *
 * Note: This script performs actual uploads, so it requires GitHub authentication.
 * Created gists and repos will be deleted after testing.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { uploadAsGist, uploadAsRepo } from '../src/index.js';

// Create a small test file
const testFilePath = path.join(os.tmpdir(), 'test-raw-url-issue-21.log');
const testContent = `Test log file for issue #21
Created at: ${new Date().toISOString()}
Purpose: Verify raw URL is returned after upload
`;

// Cleanup function
async function cleanup(gistUrl = null, repoName = null) {
  const { $ } = await import('command-stream');

  if (gistUrl) {
    const gistId = gistUrl.split('/').pop();
    console.log(`Cleaning up gist: ${gistId}`);
    try {
      await $`gh gist delete ${gistId} --yes`;
      console.log('✅ Gist deleted');
    } catch (e) {
      console.log(`⚠️ Could not delete gist: ${e.message}`);
    }
  }

  if (repoName) {
    console.log(
      `Note: Repository ${repoName} needs manual deletion (requires delete_repo scope)`
    );
    console.log(`To delete: gh repo delete ${repoName} --yes`);
  }

  // Remove test file
  if (fs.existsSync(testFilePath)) {
    fs.unlinkSync(testFilePath);
    console.log('✅ Test file deleted');
  }
}

// Test function
async function testRawUrls() {
  const { $ } = await import('command-stream');

  console.log('='.repeat(60));
  console.log('Testing Raw URL Functionality (Issue #21)');
  console.log('='.repeat(60));
  console.log('');

  // Create test file
  fs.writeFileSync(testFilePath, testContent);
  console.log(`📁 Created test file: ${testFilePath}`);
  console.log(`📊 Size: ${fs.statSync(testFilePath).size} bytes`);
  console.log('');

  let gistUrl = null;
  let repoName = null;

  try {
    // Test 1: Gist upload
    console.log('-'.repeat(40));
    console.log('Test 1: Gist Upload with Raw URL');
    console.log('-'.repeat(40));

    const gistResult = await uploadAsGist({
      filePath: testFilePath,
      isPublic: false, // Secret gist
      description: 'Test for issue #21 - raw URL feature',
      verbose: true,
    });

    gistUrl = gistResult.url;

    console.log('');
    console.log('Result:');
    console.log(`  Type: ${gistResult.type}`);
    console.log(`  URL: ${gistResult.url}`);
    console.log(`  Raw URL: ${gistResult.rawUrl || '(none)'}`);
    console.log(`  File Count: ${gistResult.fileCount}`);
    console.log(`  Is Public: ${gistResult.isPublic}`);

    // Verify raw URL is returned
    if (!gistResult.rawUrl) {
      console.log('');
      console.log('❌ FAIL: Raw URL not returned for gist');
    } else {
      console.log('');
      console.log('✅ PASS: Raw URL returned for gist');

      // Verify raw URL is accessible
      console.log('');
      console.log('Verifying raw URL accessibility...');
      const curlResult =
        await $`curl -s -o /dev/null -w "%{http_code}" "${gistResult.rawUrl}"`;
      const httpCode = curlResult.stdout.trim();

      if (httpCode === '200') {
        console.log(`✅ PASS: Raw URL accessible (HTTP ${httpCode})`);
      } else {
        console.log(`❌ FAIL: Raw URL not accessible (HTTP ${httpCode})`);
      }
    }

    console.log('');
    console.log('-'.repeat(40));
    console.log('Test 2: Repository Upload with Raw URL');
    console.log('-'.repeat(40));

    // Test 2: Repository upload
    const repoResult = await uploadAsRepo({
      filePath: testFilePath,
      isPublic: false, // Private repo
      verbose: true,
    });

    repoName = repoResult.repositoryName;

    console.log('');
    console.log('Result:');
    console.log(`  Type: ${repoResult.type}`);
    console.log(`  URL: ${repoResult.url}`);
    console.log(`  Raw URL: ${repoResult.rawUrl || '(none)'}`);
    console.log(`  File Count: ${repoResult.fileCount}`);
    console.log(`  Is Public: ${repoResult.isPublic}`);

    // Verify raw URL is returned
    if (!repoResult.rawUrl) {
      console.log('');
      console.log('❌ FAIL: Raw URL not returned for repository');
    } else {
      console.log('');
      console.log('✅ PASS: Raw URL returned for repository');

      // Check if token is present for private repos
      if (repoResult.rawUrl.includes('?token=')) {
        console.log('✅ PASS: Token present in raw URL for private repo');
      } else {
        console.log(
          '⚠️ WARNING: No token in raw URL - may not be accessible without auth'
        );
      }

      // Verify raw URL is accessible
      console.log('');
      console.log('Verifying raw URL accessibility...');
      const curlResult =
        await $`curl -s -o /dev/null -w "%{http_code}" "${repoResult.rawUrl}"`;
      const httpCode = curlResult.stdout.trim();

      if (httpCode === '200') {
        console.log(`✅ PASS: Raw URL accessible (HTTP ${httpCode})`);
      } else {
        console.log(`❌ FAIL: Raw URL not accessible (HTTP ${httpCode})`);
      }
    }

    console.log('');
    console.log('='.repeat(60));
    console.log('Test Complete');
    console.log('='.repeat(60));
  } catch (error) {
    console.error('');
    console.error('❌ Error during test:', error.message);
    console.error(error.stack);
  } finally {
    // Cleanup
    console.log('');
    console.log('Cleaning up...');
    await cleanup(gistUrl, repoName);
  }
}

// Run tests
testRawUrls().catch(console.error);

#!/usr/bin/env node

/**
 * gh-upload-log - Core library for uploading log files to GitHub
 *
 * This library provides functionality to upload log files to GitHub either as:
 * - Gists (for files <= 100MB that can fit in a gist)
 * - Repositories (for larger files that need to be split)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Constants for GitHub limits
 */
export const GITHUB_GIST_FILE_LIMIT = 100 * 1024 * 1024; // 100 MB via git
export const GITHUB_GIST_WEB_LIMIT = 25 * 1024 * 1024; // 25 MB via web
export const GITHUB_REPO_CHUNK_SIZE = 100 * 1024 * 1024; // 100 MB chunks for repo

/**
 * Normalize a file path to create a valid GitHub name
 * Replaces all '/' with '-' and removes leading slashes
 *
 * @param {string} filePath - The file path to normalize
 * @returns {string} Normalized name suitable for GitHub
 */
export function normalizeFileName(filePath) {
  return filePath.replace(/^\/*/, '').replace(/\//g, '-');
}

/**
 * Generate a repository name from a file path
 * Adds 'log-' prefix and removes extension
 *
 * @param {string} filePath - The file path
 * @returns {string} Repository name
 */
export function generateRepoName(filePath) {
  const normalized = normalizeFileName(filePath);
  const baseName = path.basename(normalized, '.log');
  return `log-${baseName}`;
}

/**
 * Generate a gist file name from a file path
 * Uses the full normalized path as the file name
 *
 * @param {string} filePath - The file path
 * @returns {string} Gist file name
 */
export function generateGistFileName(filePath) {
  return normalizeFileName(filePath);
}

/**
 * Check if a file exists
 *
 * @param {string} filePath - Path to check
 * @returns {boolean} True if file exists
 */
export function fileExists(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch (error) {
    return false;
  }
}

/**
 * Get file size in bytes
 *
 * @param {string} filePath - Path to file
 * @returns {number} File size in bytes
 */
export function getFileSize(filePath) {
  return fs.statSync(filePath).size;
}

/**
 * Determine the best upload strategy for a log file
 *
 * @param {string} filePath - Path to the log file
 * @returns {Object} Strategy object with type ('gist' or 'repo') and additional info
 */
export function determineUploadStrategy(filePath) {
  if (!fileExists(filePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }

  const fileSize = getFileSize(filePath);

  if (fileSize <= GITHUB_GIST_FILE_LIMIT) {
    return {
      type: 'gist',
      fileSize,
      needsSplit: false,
      reason: 'File fits within GitHub Gist limit (100MB)'
    };
  } else {
    const numChunks = Math.ceil(fileSize / GITHUB_REPO_CHUNK_SIZE);
    return {
      type: 'repo',
      fileSize,
      needsSplit: true,
      numChunks,
      chunkSize: GITHUB_REPO_CHUNK_SIZE,
      reason: `File exceeds Gist limit, will be split into ${numChunks} chunks`
    };
  }
}

/**
 * Split a file into chunks
 *
 * @param {string} inputPath - Path to input file
 * @param {string} outputDir - Directory to write chunks to
 * @param {number} chunkSize - Size of each chunk in bytes
 * @returns {Promise<string[]>} Array of chunk file paths
 */
export async function splitFileIntoChunks(inputPath, outputDir, chunkSize = GITHUB_REPO_CHUNK_SIZE) {
  const { $ } = await import('command-stream');

  const baseName = path.basename(normalizeFileName(inputPath), '.log');
  const chunkPrefix = `${baseName}.part-`;

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Use split command to create chunks
  // -b: bytes per chunk, -d: use numeric suffixes, -a: suffix length
  const chunkSizeMB = Math.ceil(chunkSize / (1024 * 1024));
  await $`split -b ${chunkSizeMB}m -d -a 2 ${inputPath} ${path.join(outputDir, chunkPrefix)}`;

  // Get list of created chunks
  const chunks = fs.readdirSync(outputDir)
    .filter(file => file.startsWith(chunkPrefix))
    .sort()
    .map(file => path.join(outputDir, file));

  return chunks;
}

/**
 * Upload a file as a GitHub Gist
 *
 * @param {string} filePath - Path to the file to upload
 * @param {Object} options - Upload options
 * @param {boolean} options.isPublic - Whether the gist should be public (default: false)
 * @param {string} options.description - Description for the gist
 * @returns {Promise<Object>} Gist information including URL
 */
export async function uploadAsGist(filePath, options = {}) {
  const { $ } = await import('command-stream');

  const isPublic = options.isPublic !== undefined ? options.isPublic : false;
  const gistFileName = generateGistFileName(filePath);
  const description = options.description || `Log file: ${path.basename(filePath)}`;

  // Create gist using gh CLI
  const visibility = isPublic ? '--public' : '';
  const result = await $`gh gist create ${filePath} ${visibility} --desc ${description}`;

  // Extract gist URL from output
  const gistUrl = result.stdout.trim();

  return {
    type: 'gist',
    url: gistUrl,
    fileName: gistFileName,
    isPublic
  };
}

/**
 * Upload a file as a GitHub repository (with splitting if needed)
 *
 * @param {string} filePath - Path to the file to upload
 * @param {Object} options - Upload options
 * @param {boolean} options.isPublic - Whether the repo should be public (default: false)
 * @param {string} options.description - Description for the repo
 * @returns {Promise<Object>} Repository information including URL
 */
export async function uploadAsRepo(filePath, options = {}) {
  const { $ } = await import('command-stream');

  const isPublic = options.isPublic !== undefined ? options.isPublic : false;
  const repoName = generateRepoName(filePath);
  const normalized = normalizeFileName(filePath);
  const workDir = `/tmp/${repoName}-${Date.now()}`;

  try {
    // Create work directory
    console.log(`→ Creating work directory: ${workDir}`);
    fs.mkdirSync(workDir, { recursive: true });

    // Copy file to work directory
    console.log('→ Copying file...');
    fs.copyFileSync(filePath, path.join(workDir, normalized));

    // Split file if needed
    const fileSize = getFileSize(filePath);
    if (fileSize > GITHUB_REPO_CHUNK_SIZE) {
      console.log('→ Splitting file into 100MB chunks...');
      await splitFileIntoChunks(
        path.join(workDir, normalized),
        workDir,
        GITHUB_REPO_CHUNK_SIZE
      );

      // Remove original large file
      console.log('→ Removing original large file...');
      fs.unlinkSync(path.join(workDir, normalized));
    }

    // Initialize git repository
    console.log('→ Initializing git repository...');
    await $`cd ${workDir} && git init`;
    await $`cd ${workDir} && git branch -m main`;

    // Add and commit files
    console.log('→ Adding and committing files...');
    await $`cd ${workDir} && git add .`;
    await $`cd ${workDir} && git commit -m "Add log file"`;

    // Get current GitHub user
    const whoamiResult = await $`gh api user --jq .login`;
    const githubUser = whoamiResult.stdout.trim();

    // Create GitHub repo and push
    console.log(`→ Creating ${isPublic ? 'public' : 'private'} GitHub repo: ${repoName}`);
    const visibility = isPublic ? '--public' : '--private';
    await $`cd ${workDir} && gh repo create ${repoName} ${visibility} --source=. --push`;

    const repoUrl = `https://github.com/${githubUser}/${repoName}`;

    return {
      type: 'repo',
      url: repoUrl,
      repoName,
      isPublic,
      workDir // Keep for debugging; caller can clean up
    };
  } catch (error) {
    // Clean up on error
    if (fs.existsSync(workDir)) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
    throw error;
  }
}

/**
 * Main function to upload a log file to GitHub
 * Automatically determines the best strategy (gist vs repo)
 *
 * @param {string} filePath - Path to the log file
 * @param {Object} options - Upload options
 * @param {boolean} options.isPublic - Whether to make it public (default: false/private)
 * @param {boolean} options.forceGist - Force upload as gist even if it might not fit
 * @param {boolean} options.forceRepo - Force upload as repository
 * @param {string} options.description - Description for the upload
 * @returns {Promise<Object>} Upload result with URL and metadata
 */
export async function uploadLog(filePath, options = {}) {
  // Validate file exists
  if (!fileExists(filePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }

  const strategy = determineUploadStrategy(filePath);

  console.log(`File size: ${(strategy.fileSize / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`Strategy: ${strategy.reason}`);

  // Allow forcing a specific strategy
  let uploadType = strategy.type;
  if (options.forceGist) {
    uploadType = 'gist';
  } else if (options.forceRepo) {
    uploadType = 'repo';
  }

  if (uploadType === 'gist') {
    return await uploadAsGist(filePath, options);
  } else {
    return await uploadAsRepo(filePath, options);
  }
}

export default {
  uploadLog,
  uploadAsGist,
  uploadAsRepo,
  determineUploadStrategy,
  normalizeFileName,
  generateRepoName,
  generateGistFileName,
  fileExists,
  getFileSize,
  splitFileIntoChunks,
  GITHUB_GIST_FILE_LIMIT,
  GITHUB_GIST_WEB_LIMIT,
  GITHUB_REPO_CHUNK_SIZE
};

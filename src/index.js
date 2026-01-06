#!/usr/bin/env bun

/**
 * gh-upload-log - Core library for uploading log files to GitHub
 *
 * This library provides functionality to upload log files to GitHub either as:
 * - Gists (for files <= 100MB that can fit in a gist)
 * - Repositories (for larger files that need to be split)
 */

import fs from 'node:fs';
import path from 'node:path';
import makeLog from 'log-lazy';

/**
 * Create a logger instance
 * This can be customized by users when using the library
 */
function createDefaultLogger(options = {}) {
  const { verbose = false, logger = console } = options;

  const log = makeLog({
    level: verbose ? 'development' : 'info',
    log: {
      fatal: logger.error || logger.log,
      error: logger.error || logger.log,
      warn: logger.warn || logger.log,
      info: logger.log,
      debug: logger.debug || logger.log,
      verbose: logger.log,
      trace: logger.log,
      silly: logger.log,
    },
  });

  return log;
}

/**
 * Constants for GitHub limits
 *
 * Note: While GitHub documents a 100MB limit for gist files, the API has
 * practical limitations. Large files (>25MB) can cause HTTP 502 errors
 * due to request payload size limits. The safe threshold for gists via
 * the API matches the web interface limit of 25MB.
 *
 * See: https://github.com/orgs/community/discussions/147837
 */
export const GITHUB_GIST_FILE_LIMIT = 25 * 1024 * 1024; // 25 MB - safe API limit (matches web interface)
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
  } catch {
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
 * Format file size in human-readable format
 *
 * @param {number} bytes - File size in bytes
 * @returns {string} Human-readable file size (e.g., "1.5 KB", "2.3 MB")
 */
export function formatFileSize(bytes) {
  if (bytes === 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const base = 1024;

  // Find the appropriate unit
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(base)),
    units.length - 1
  );
  const size = bytes / Math.pow(base, unitIndex);

  // Format with appropriate decimal places
  // Use 0 decimals for bytes, 2 for larger units
  if (unitIndex === 0) {
    return `${size} ${units[unitIndex]}`;
  }
  return `${size.toFixed(2)} ${units[unitIndex]}`;
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
      reason: 'File fits within GitHub Gist API limit (25MB)',
    };
  } else {
    const numChunks = Math.ceil(fileSize / GITHUB_REPO_CHUNK_SIZE);
    const needsSplit = fileSize > GITHUB_REPO_CHUNK_SIZE;
    return {
      type: 'repo',
      fileSize,
      needsSplit,
      numChunks,
      chunkSize: GITHUB_REPO_CHUNK_SIZE,
      reason: needsSplit
        ? `File exceeds Gist limit, will be split into ${numChunks} chunks`
        : 'File exceeds Gist limit, will upload as repository',
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
export async function splitFileIntoChunks(
  inputPath,
  outputDir,
  chunkSize = GITHUB_REPO_CHUNK_SIZE
) {
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
  const chunks = fs
    .readdirSync(outputDir)
    .filter((file) => file.startsWith(chunkPrefix))
    .sort()
    .map((file) => path.join(outputDir, file));

  return chunks;
}

/**
 * Upload a file as a GitHub Gist
 *
 * @param {Object} options - Upload options
 * @param {string} options.filePath - Path to the file to upload
 * @param {boolean} options.isPublic - Whether the gist should be public (default: false)
 * @param {string} options.description - Description for the gist
 * @param {boolean} options.verbose - Enable verbose logging (default: false)
 * @param {Object} options.logger - Logging target (default: console)
 * @returns {Promise<Object>} Gist information including URL
 */
export async function uploadAsGist(options = {}) {
  const { $ } = await import('command-stream');

  const {
    filePath,
    isPublic = false,
    description,
    verbose = false,
    logger = console,
  } = options;

  if (!filePath) {
    throw new Error('filePath is required in options');
  }

  const log = createDefaultLogger({ verbose, logger });
  const gistFileName = generateGistFileName(filePath);
  const desc = description || `Log file: ${path.basename(filePath)}`;

  log.debug(() => `Creating GitHub Gist for ${filePath}`);
  log.debug(() => `Gist file name: ${gistFileName}`);
  log.debug(() => `Description: ${desc}`);

  // Create gist using gh CLI
  // Note: We use separate commands for public/private to avoid empty string interpolation issues
  let result;
  if (isPublic) {
    result = await $`gh gist create ${filePath} --public --desc ${desc}`;
  } else {
    result = await $`gh gist create ${filePath} --desc ${desc}`;
  }

  // Extract gist URL from output
  const gistUrl = result.stdout.trim();

  // Validate that gist was created successfully
  // The gh CLI returns the gist URL to stdout on success
  // On failure (e.g., HTTP 502), stdout is empty and error is in stderr
  if (
    !gistUrl ||
    !gistUrl.startsWith('https://gist.github.com/') ||
    gistUrl === 'https://gist.github.com/'
  ) {
    const errorMessage = result.stderr ? result.stderr.trim() : 'Unknown error';
    throw new Error(`Failed to create gist: ${errorMessage}`);
  }

  log.debug(() => `Gist created successfully: ${gistUrl}`);

  return {
    type: 'gist',
    url: gistUrl,
    fileName: gistFileName,
    isPublic,
  };
}

/**
 * Upload a file as a GitHub repository (with splitting if needed)
 *
 * @param {Object} options - Upload options
 * @param {string} options.filePath - Path to the file to upload
 * @param {boolean} options.isPublic - Whether the repo should be public (default: false)
 * @param {string} options.description - Description for the repo
 * @param {boolean} options.verbose - Enable verbose logging (default: false)
 * @param {Object} options.logger - Logging target (default: console)
 * @returns {Promise<Object>} Repository information including URL
 */
export async function uploadAsRepo(options = {}) {
  const { $ } = await import('command-stream');

  const {
    filePath,
    isPublic = false,
    verbose = false,
    logger = console,
  } = options;

  if (!filePath) {
    throw new Error('filePath is required in options');
  }

  const log = createDefaultLogger({ verbose, logger });
  const repositoryName = generateRepoName(filePath);
  const normalized = normalizeFileName(filePath);
  const workDir = `/tmp/${repositoryName}-${Date.now()}`;

  try {
    // Create work directory
    log.debug(() => `→ Creating work directory: ${workDir}`);
    fs.mkdirSync(workDir, { recursive: true });

    // Copy file to work directory
    log.debug(() => '→ Copying file...');
    fs.copyFileSync(filePath, path.join(workDir, normalized));

    // Split file if needed
    const fileSize = getFileSize(filePath);
    if (fileSize > GITHUB_REPO_CHUNK_SIZE) {
      log.debug(() => '→ Splitting file into 100MB chunks...');
      log.debug(
        () =>
          `File size: ${fileSize} bytes, chunk size: ${GITHUB_REPO_CHUNK_SIZE} bytes`
      );

      await splitFileIntoChunks(
        path.join(workDir, normalized),
        workDir,
        GITHUB_REPO_CHUNK_SIZE
      );

      // Remove original large file
      log.debug(() => '→ Removing original large file...');
      fs.unlinkSync(path.join(workDir, normalized));
    }

    // Initialize git repository
    log.debug(() => '→ Initializing git repository...');
    await $`cd ${workDir} && git init`;
    await $`cd ${workDir} && git branch -m main`;

    // Add and commit files
    log.debug(() => '→ Adding and committing files...');
    await $`cd ${workDir} && git add .`;
    await $`cd ${workDir} && git commit -m "Add log file"`;

    // Get current GitHub user
    log.debug(() => 'Getting GitHub user information...');
    const whoamiResult = await $`gh api user --jq .login`;
    const githubUser = whoamiResult.stdout.trim();
    log.debug(() => `GitHub user: ${githubUser}`);

    // Create GitHub repo and push
    log.debug(
      () =>
        `→ Creating ${isPublic ? 'public' : 'private'} GitHub repo: ${repositoryName}`
    );
    const visibility = isPublic ? '--public' : '--private';
    await $`cd ${workDir} && gh repo create ${repositoryName} ${visibility} --source=. --push`;

    const repoUrl = `https://github.com/${githubUser}/${repositoryName}`;

    log.debug(() => `Repository created successfully: ${repoUrl}`);

    return {
      type: 'repo',
      url: repoUrl,
      repositoryName,
      isPublic,
      workDir, // Keep for debugging; caller can clean up
    };
  } catch (error) {
    log.error(() => `Error uploading as repository: ${error.message}`);
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
 * @param {Object} options - Upload options
 * @param {string} options.filePath - Path to the log file
 * @param {boolean} options.isPublic - Whether to make it public (default: false/private)
 * @param {boolean} options.auto - Automatically choose strategy (default: true)
 * @param {boolean} options.onlyGist - Upload only as gist (disables auto mode)
 * @param {boolean} options.onlyRepository - Upload only as repository (disables auto mode)
 * @param {boolean} options.dryMode - Dry run mode - don't actually upload
 * @param {string} options.description - Description for the upload
 * @param {boolean} options.verbose - Enable verbose logging (default: false)
 * @param {Object} options.logger - Logging target (default: console)
 * @returns {Promise<Object>} Upload result with URL and metadata
 */
export async function uploadLog(options = {}) {
  const {
    filePath,
    isPublic = false,
    auto = true,
    onlyGist = false,
    onlyRepository = false,
    dryMode = false,
    description,
    verbose = false,
    logger = console,
  } = options;

  if (!filePath) {
    throw new Error('filePath is required in options');
  }

  // Validate file exists
  if (!fileExists(filePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }

  const log = createDefaultLogger({ verbose, logger });
  const strategy = determineUploadStrategy(filePath);

  // Only show strategy details in verbose mode
  log.debug(() => `File size: ${formatFileSize(strategy.fileSize)}`);
  log.debug(() => `Strategy: ${strategy.reason}`);

  // Determine upload type based on options
  let uploadType = strategy.type;

  // If onlyGist or onlyRepository is specified, use that
  if (onlyGist) {
    uploadType = 'gist';
    log.debug(() => 'Mode: Only Gist (forced)');
  } else if (onlyRepository) {
    uploadType = 'repo';
    log.debug(() => 'Mode: Only Repository (forced)');
  } else if (auto !== false) {
    // Auto mode is default
    log.debug(() => 'Mode: Auto (automatic strategy selection)');
  }

  // In dry mode, return mock result without uploading
  if (dryMode) {
    log.debug(() => `DRY MODE: Upload Type: ${uploadType}`);
    log.debug(() => `DRY MODE: Visibility: ${isPublic ? 'public' : 'private'}`);
    log.debug(() => `DRY MODE: Description: ${description || 'N/A'}`);

    return {
      type: uploadType,
      url: `[DRY MODE] Would create ${uploadType === 'gist' ? 'gist' : 'repository'}`,
      fileName:
        uploadType === 'gist' ? generateGistFileName(filePath) : undefined,
      repositoryName:
        uploadType === 'repo' ? generateRepoName(filePath) : undefined,
      isPublic: isPublic || false,
      dryMode: true,
    };
  }

  if (uploadType === 'gist') {
    // Try gist upload first, fallback to repository on failure (unless onlyGist is set)
    try {
      return await uploadAsGist(options);
    } catch (gistError) {
      // If user explicitly requested only gist, don't fallback
      if (onlyGist) {
        throw gistError;
      }

      // Log the fallback and try repository mode
      log.warn(
        () =>
          `Gist upload failed: ${gistError.message}. Falling back to repository mode...`
      );

      return await uploadAsRepo(options);
    }
  } else {
    return await uploadAsRepo(options);
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
  formatFileSize,
  splitFileIntoChunks,
  GITHUB_GIST_FILE_LIMIT,
  GITHUB_GIST_WEB_LIMIT,
  GITHUB_REPO_CHUNK_SIZE,
};

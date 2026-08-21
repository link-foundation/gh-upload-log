#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import makeLog from 'log-lazy';

/**
 * Check if an error is an ENOSPC (no space left on device) error
 *
 * @param {Error} error - The error to check
 * @returns {boolean} True if the error is ENOSPC
 */
export function isENOSPC(error) {
  if (!error) {
    return false;
  }
  if (error.code === 'ENOSPC') {
    return true;
  }
  if (error.message && error.message.includes('ENOSPC')) {
    return true;
  }
  if (
    error.message &&
    error.message.toLowerCase().includes('no space left on device')
  ) {
    return true;
  }
  if (error.stderr && error.stderr.includes('ENOSPC')) {
    return true;
  }
  if (
    error.stderr &&
    error.stderr.toLowerCase().includes('no space left on device')
  ) {
    return true;
  }
  return false;
}

/**
 * Create a structured ENOSPC error with actionable information
 *
 * @param {string} operation - Description of the operation that failed
 * @param {Error} originalError - The original error
 * @returns {Error} Enhanced error with ENOSPC metadata
 */
export function createENOSPCError(operation, originalError) {
  const error = new Error(
    `No space left on device during ${operation}. ` +
      `Suggestion: Free disk space and retry. ` +
      `Check large files in ~/.claude/debug, /tmp, or system logs.`
  );
  error.code = 'ENOSPC';
  error.operation = operation;
  error.originalError = originalError;
  return error;
}

/**
 * Create a logger instance
 * This can be customized by users when using the library
 *
 * @param {Object} options - Logger options
 * @returns {Object} Logger instance
 */
export function createDefaultLogger(options = {}) {
  const { verbose = false, logger = console } = options;

  return makeLog({
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
}

/**
 * Load the command-stream tag or a test override
 *
 * @param {Object} [options={}] - Optional command runner overrides
 * @returns {Promise<Function>} command-stream template tag function
 */
export async function getCommandStream(options = {}) {
  if (typeof options.commandStreamFactory === 'function') {
    return options.commandStreamFactory();
  }

  const { $ } = await import('command-stream');
  return $;
}

/**
 * Get the exit code from a command-stream result
 *
 * @param {Object} result - command-stream result object
 * @returns {number} Exit code (0 when unavailable)
 */
export function getCommandExitCode(result) {
  if (typeof result?.code === 'number') {
    return result.code;
  }
  if (typeof result?.child?.exitCode === 'number') {
    return result.child.exitCode;
  }
  return 0;
}

/**
 * Throw when a command-stream result indicates a failed command
 *
 * @param {Object} result - command-stream result object
 * @param {string} operation - Human-readable operation description
 * @returns {Object} The original result when successful
 */
export function ensureCommandSucceeded(result, operation) {
  const exitCode = getCommandExitCode(result);

  if (exitCode === 0) {
    return result;
  }

  const stderr = result?.stderr?.trim();
  const stdout = result?.stdout?.trim();
  const detail = stderr || stdout || `Command exited with code ${exitCode}`;
  const error = new Error(`Failed to ${operation}: ${detail}`);

  error.code = exitCode;
  error.stdout = result?.stdout || '';
  error.stderr = result?.stderr || '';
  error.commandResult = result;

  throw error;
}

/**
 * Extract a GitHub repository URL from command output
 *
 * @param {string} output - Command stdout
 * @returns {string|null} Repository URL if found
 */
export function extractGitHubRepoUrl(output = '') {
  return (
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+$/.test(line)) ||
    null
  );
}

/**
 * Check whether repository creation failed because the generated name already exists
 *
 * @param {string} errorText - stderr or error message from gh repo create
 * @returns {boolean} True when the repo name is already taken on the current account
 */
export function isRepositoryNameConflict(errorText = '') {
  const normalized = errorText.toLowerCase();
  return (
    normalized.includes('name already exists on this account') ||
    normalized.includes('already exists')
  );
}

/**
 * Generate a collision-safe repository name by appending a timestamp suffix
 *
 * @param {string} repositoryName - Base repository name
 * @param {number} [timestamp=Date.now()] - Timestamp or numeric suffix
 * @returns {string} Unique repository name candidate
 */
export function generateCollisionRepoName(
  repositoryName,
  timestamp = Date.now()
) {
  return `${repositoryName}-${timestamp}`;
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
export const GITHUB_GIST_FILE_LIMIT = 25 * 1024 * 1024;
export const GITHUB_GIST_WEB_LIMIT = 25 * 1024 * 1024;
export const GITHUB_REPO_CHUNK_SIZE = 100 * 1024 * 1024;
export const DEFAULT_PRIVATE_LOGS_REPOSITORY = 'private-logs';
export const DEFAULT_PUBLIC_LOGS_REPOSITORY = 'public-logs';
export const LOG_TEXT_EXTENSION = '.log.txt';

/**
 * GitHub rejects repository names longer than 100 characters, and git limits a
 * single path component to 255 bytes. Absolute paths are used to build both
 * names, so deep paths have to be shortened deterministically.
 */
export const MAX_REPOSITORY_NAME_LENGTH = 100;
export const MAX_UPLOADED_FILE_NAME_LENGTH = 200;

/**
 * Shorten a generated name deterministically when it exceeds a limit
 *
 * Keeps the most specific (trailing) part of the name and prefixes it with a
 * short hash of the full name, so the result stays unique and stable for the
 * same input path (which keeps shared-repository deduplication working).
 *
 * @param {string} name - Name to shorten
 * @param {number} maxLength - Maximum allowed length
 * @returns {string} Name guaranteed to be at most maxLength characters
 */
export function shortenGeneratedName(name, maxLength) {
  if (name.length <= maxLength) {
    return name;
  }

  const hash = createHash('sha1').update(name).digest('hex').slice(0, 8);
  const keptLength = Math.max(maxLength - hash.length - 1, 0);
  return `${hash}-${name.slice(name.length - keptLength)}`.slice(0, maxLength);
}

/**
 * Resolve a user-supplied log file path into an absolute path
 *
 * Accepts every path form a shell user can type: relative (`app.log`,
 * `./app.log`, `../logs/app.log`), home-relative (`~/app.log`, quoted so the
 * shell does not expand it), and absolute paths. Resolving early guarantees
 * that later file operations keep working even when the working directory
 * changes during the upload, and that generated names are identical no matter
 * how the same file was addressed.
 *
 * @param {string} filePath - Raw file path from CLI arguments or library options
 * @returns {string} Absolute file path
 */
export function resolveLogFilePath(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new Error('filePath is required in options');
  }

  const home = os.homedir();
  let expanded = filePath;

  if (filePath === '~') {
    expanded = home;
  } else if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
    expanded = path.join(home, filePath.slice(2));
  }

  return path.resolve(expanded);
}

/**
 * Create a temporary working directory path inside the OS temp directory
 *
 * @param {string} prefix - Directory name prefix
 * @param {number} [timestamp=Date.now()] - Unique suffix
 * @returns {string} Absolute path to the temporary working directory
 */
export function createWorkDirPath(prefix, timestamp = Date.now()) {
  return path.join(os.tmpdir(), `${prefix}-${timestamp}`);
}

/**
 * Normalize a file path to create a valid GitHub name
 * Replaces all '/' with '-' and removes leading slashes
 *
 * @param {string} filePath - The file path to normalize
 * @returns {string} Normalized name suitable for GitHub
 */
export function normalizeFileName(filePath) {
  return filePath
    .replace(/^([A-Za-z]):/, '$1')
    .replace(/^[\\/]+/, '')
    .replace(/[\\/]/g, '-');
}

/**
 * Ensure uploaded log files use a browser-friendly text extension
 *
 * @param {string} fileName - Normalized file name
 * @returns {string} File name ending in .log.txt
 */
export function ensureLogTextExtension(fileName) {
  if (fileName.endsWith(LOG_TEXT_EXTENSION)) {
    return fileName;
  }

  if (fileName.endsWith('.log')) {
    return `${fileName}.txt`;
  }

  return `${fileName}${LOG_TEXT_EXTENSION}`;
}

/**
 * Generate the user-facing uploaded log file name from a file path
 *
 * @param {string} filePath - The file path
 * @returns {string} Normalized file name ending in .log.txt
 */
export function generateUploadedLogFileName(filePath) {
  const fileName = ensureLogTextExtension(normalizeFileName(filePath));

  if (fileName.length <= MAX_UPLOADED_FILE_NAME_LENGTH) {
    return fileName;
  }

  const baseName = fileName.slice(0, -LOG_TEXT_EXTENSION.length);
  const shortened = shortenGeneratedName(
    baseName,
    MAX_UPLOADED_FILE_NAME_LENGTH - LOG_TEXT_EXTENSION.length
  );
  return `${shortened}${LOG_TEXT_EXTENSION}`;
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
  return `log-${shortenGeneratedName(baseName, MAX_REPOSITORY_NAME_LENGTH - 'log-'.length)}`;
}

/**
 * Generate a gist file name from a file path
 * Uses the full normalized path as the file name
 *
 * @param {string} filePath - The file path
 * @returns {string} Gist file name
 */
export function generateGistFileName(filePath) {
  return generateUploadedLogFileName(filePath);
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
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(base)),
    units.length - 1
  );
  const size = bytes / Math.pow(base, unitIndex);

  if (unitIndex === 0) {
    return `${size} ${units[unitIndex]}`;
  }
  return `${size.toFixed(2)} ${units[unitIndex]}`;
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

  const inputFileName = inputPath.split(/[\\/]/).pop();
  const uploadedFileName = ensureLogTextExtension(
    normalizeFileName(inputFileName)
  );
  const baseName = uploadedFileName.slice(0, -LOG_TEXT_EXTENSION.length);
  const chunkPrefix = `${baseName}.part-`;

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const chunkSizeMB = Math.ceil(chunkSize / (1024 * 1024));
  const splitResult =
    await $`split -b ${chunkSizeMB}m -d -a 2 ${inputPath} ${path.join(outputDir, chunkPrefix)}`;
  ensureCommandSucceeded(splitResult, 'split log file into repository chunks');

  const splitFiles = fs
    .readdirSync(outputDir)
    .filter((file) => file.startsWith(chunkPrefix))
    .sort()
    .map((file) => {
      const currentPath = path.join(outputDir, file);
      const finalPath = currentPath.endsWith(LOG_TEXT_EXTENSION)
        ? currentPath
        : `${currentPath}${LOG_TEXT_EXTENSION}`;

      if (currentPath !== finalPath) {
        fs.renameSync(currentPath, finalPath);
      }

      return finalPath;
    });

  return splitFiles.sort();
}

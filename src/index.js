#!/usr/bin/env bun

/**
 * gh-upload-log - Core library for uploading log files to GitHub
 *
 * This library provides functionality to upload log files to GitHub either as:
 * - Gists (for files <= 25MB that fit in a gist)
 * - Repositories (for larger files that need repository storage)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildLogRepositoryPath,
  createDefaultLogger,
  createENOSPCError,
  DEFAULT_PRIVATE_LOGS_REPOSITORY,
  DEFAULT_PUBLIC_LOGS_REPOSITORY,
  fileExists,
  formatFileSize,
  generateFileContentHash,
  generateGistFileName,
  generateLogDirectorySegment,
  generateRepoName,
  generateStoredLogFileName,
  generateUploadedLogFileName,
  getCommandStream,
  getFileSize,
  GITHUB_GIST_DOCUMENTED_FILE_LIMIT,
  GITHUB_GIST_FILE_LIMIT,
  GITHUB_GIST_WEB_LIMIT,
  GITHUB_REPO_CHUNK_SIZE,
  isENOSPC,
  isStoredLogFileName,
  LOG_CONTENT_HASH_LENGTH,
  normalizeFileName,
  parseFileSize,
  resolveLogFilePath,
  splitFileIntoChunks,
} from './common.js';
import {
  checkRawUrlExists,
  getSharedRepositoryName,
  shouldUseSharedRepositoryMode,
  uploadAsRepo,
} from './repository-upload.js';

export {
  buildLogRepositoryPath,
  checkRawUrlExists,
  createENOSPCError,
  DEFAULT_PRIVATE_LOGS_REPOSITORY,
  DEFAULT_PUBLIC_LOGS_REPOSITORY,
  fileExists,
  formatFileSize,
  generateFileContentHash,
  generateGistFileName,
  generateLogDirectorySegment,
  generateRepoName,
  generateStoredLogFileName,
  generateUploadedLogFileName,
  getFileSize,
  GITHUB_GIST_DOCUMENTED_FILE_LIMIT,
  GITHUB_GIST_FILE_LIMIT,
  GITHUB_GIST_WEB_LIMIT,
  GITHUB_REPO_CHUNK_SIZE,
  isENOSPC,
  isStoredLogFileName,
  LOG_CONTENT_HASH_LENGTH,
  normalizeFileName,
  parseFileSize,
  resolveLogFilePath,
  splitFileIntoChunks,
  uploadAsRepo,
};

/**
 * Normalize the configured gist size threshold
 *
 * Values are clamped to GitHub's documented 100MB gist file limit, because
 * anything above it is rejected by the API (measured in docs/case-studies/issue-38).
 *
 * @param {number} [gistFileLimit] - Requested threshold in bytes
 * @returns {number} Threshold in bytes
 */
export function resolveGistFileLimit(gistFileLimit) {
  if (typeof gistFileLimit !== 'number' || !Number.isFinite(gistFileLimit)) {
    return GITHUB_GIST_FILE_LIMIT;
  }

  if (gistFileLimit <= 0) {
    return 0;
  }

  return Math.min(gistFileLimit, GITHUB_GIST_DOCUMENTED_FILE_LIMIT);
}

/**
 * Determine the best upload strategy for a log file
 *
 * @param {string} rawFilePath - Path to the log file
 * @param {Object} [options={}] - Strategy options
 * @param {number} [options.gistFileLimit] - Maximum size uploaded as a gist (bytes)
 * @returns {Object} Strategy object with type ('gist' or 'repo') and additional info
 */
export function determineUploadStrategy(rawFilePath, options = {}) {
  const filePath = resolveLogFilePath(rawFilePath);

  if (!fileExists(filePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }

  const fileSize = getFileSize(filePath);
  const gistFileLimit = resolveGistFileLimit(options.gistFileLimit);

  if (fileSize <= gistFileLimit) {
    return {
      type: 'gist',
      fileSize,
      gistFileLimit,
      needsSplit: false,
      reason: `File fits within the configured GitHub Gist limit (${formatFileSize(gistFileLimit)})`,
    };
  }

  const numChunks = Math.ceil(fileSize / GITHUB_REPO_CHUNK_SIZE);
  const needsSplit = fileSize > GITHUB_REPO_CHUNK_SIZE;
  return {
    type: 'repo',
    fileSize,
    gistFileLimit,
    needsSplit,
    numChunks,
    chunkSize: GITHUB_REPO_CHUNK_SIZE,
    reason: needsSplit
      ? `File exceeds Gist limit, will be split into ${numChunks} chunks`
      : 'File exceeds Gist limit, will upload as repository',
  };
}

/**
 * Number of extra `gh gist create` attempts made after a transient failure
 */
export const DEFAULT_GIST_RETRIES = 2;

/**
 * Detect gateway errors that GitHub returns intermittently for large gists
 *
 * The size probes recorded in docs/case-studies/issue-38 show the same payload
 * failing with HTTP 502/504 and succeeding on the next attempt, so these are
 * worth retrying before falling back to repository mode.
 *
 * @param {string} errorText - stderr from `gh gist create`
 * @returns {boolean} True when the failure looks transient
 */
export function isTransientGistError(errorText = '') {
  return /http (502|503|504)|bad gateway|gateway time-?out|server error|couldn't respond to your request in time/i.test(
    errorText
  );
}

/**
 * Upload a file as a GitHub Gist
 *
 * @param {Object} options - Upload options
 * @param {string} options.filePath - Path to the file to upload
 * @param {boolean} options.isPublic - Whether the gist should be public (default: false)
 * @param {string} options.description - Description for the gist
 * @param {number} options.gistRetries - Retries for transient gateway errors (default: 2)
 * @param {boolean} options.verbose - Enable verbose logging (default: false)
 * @param {Object} options.logger - Logging target (default: console)
 * @returns {Promise<Object>} Gist information including URL
 */
export async function uploadAsGist(options = {}) {
  const $ = await getCommandStream(options);
  const {
    isPublic = false,
    description,
    gistRetries = DEFAULT_GIST_RETRIES,
    verbose = false,
    logger = console,
  } = options;

  if (!options.filePath) {
    throw new Error('filePath is required in options');
  }

  // Resolve to an absolute path so relative and home-relative paths keep
  // working even if the working directory changes during the upload.
  const filePath = resolveLogFilePath(options.filePath);
  const log = createDefaultLogger({ verbose, logger });
  const gistFileName = generateGistFileName(filePath);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-upload-log-gist-'));
  const stagedFilePath = path.join(workDir, gistFileName);
  const desc = description || `Log file: ${path.basename(filePath)}`;

  log.debug(() => `Creating GitHub Gist for ${filePath}`);
  log.debug(() => `Gist file name: ${gistFileName}`);
  log.debug(() => `Description: ${desc}`);

  let result;
  try {
    fs.copyFileSync(filePath, stagedFilePath);

    const maxAttempts = Math.max(1, Number(gistRetries) + 1);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      result = isPublic
        ? await $`gh gist create ${stagedFilePath} --public --desc ${desc}`
        : await $`gh gist create ${stagedFilePath} --desc ${desc}`;

      const failureText = `${result?.stderr || ''}${result?.stdout || ''}`;
      const succeeded = result?.stdout
        ?.trim()
        .startsWith('https://gist.github.com/');

      if (succeeded || attempt === maxAttempts) {
        break;
      }

      if (!isTransientGistError(failureText)) {
        break;
      }

      log.warn(
        () =>
          `Gist upload attempt ${attempt}/${maxAttempts} hit a transient GitHub error; retrying...`
      );
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  const gistUrl = result.stdout.trim();
  if (
    !gistUrl ||
    !gistUrl.startsWith('https://gist.github.com/') ||
    gistUrl === 'https://gist.github.com/'
  ) {
    const errorMessage = result.stderr ? result.stderr.trim() : 'Unknown error';
    throw new Error(`Failed to create gist: ${errorMessage}`);
  }

  log.debug(() => `Gist created successfully: ${gistUrl}`);

  const gistId = gistUrl.split('/').pop();
  let rawUrl = null;
  let fileCount = 1;

  try {
    log.debug(() => 'Fetching gist details for raw URL...');
    const $silent = $({ mirror: false, capture: true });
    const gistDetails =
      await $silent`gh api gists/${gistId} --jq '.files | to_entries | map({filename: .key, raw_url: .value.raw_url})'`;
    const files = JSON.parse(gistDetails.stdout.trim());
    fileCount = files.length;

    if (fileCount === 1) {
      rawUrl = files[0].raw_url;
      log.debug(() => `Raw URL: ${rawUrl}`);
    } else {
      log.debug(
        () => `Gist has ${fileCount} files, skipping single-file raw URL`
      );
    }
  } catch (apiError) {
    log.debug(() => `Could not fetch gist details: ${apiError.message}`);
  }

  return {
    type: 'gist',
    url: gistUrl,
    rawUrl,
    fileName: gistFileName,
    fileCount,
    isPublic,
  };
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
 * @param {boolean} options.useSharedRepository - Use shared log repositories for repository-mode uploads (default: true)
 * @param {boolean} options.dryMode - Dry run mode - don't actually upload
 * @param {string} options.description - Description for the upload
 * @param {number} options.gistFileLimit - Maximum size uploaded as a gist (bytes, default: 25MB)
 * @param {boolean} options.checkRawUrl - Verify the returned raw URL is reachable (default: false)
 * @param {boolean} options.verbose - Enable verbose logging (default: false)
 * @param {Object} options.logger - Logging target (default: console)
 * @returns {Promise<Object>} Upload result with URL and metadata
 */
export async function uploadLog(options = {}) {
  const {
    isPublic = false,
    auto = true,
    onlyGist = false,
    onlyRepository = false,
    useSharedRepository = true,
    dryMode = false,
    description,
    gistFileLimit,
    checkRawUrl = false,
    verbose = false,
    logger = console,
  } = options;

  if (!options.filePath) {
    throw new Error('filePath is required in options');
  }

  // Resolve once and reuse the absolute path for every downstream step so that
  // relative paths (`app.log`, `./app.log`, `~/app.log`) are fully supported.
  const filePath = resolveLogFilePath(options.filePath);
  const resolvedOptions = { ...options, filePath };

  if (!fileExists(filePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }

  const log = createDefaultLogger({ verbose, logger });
  const strategy = determineUploadStrategy(filePath, { gistFileLimit });

  log.debug(() => `File size: ${formatFileSize(strategy.fileSize)}`);
  log.debug(() => `Strategy: ${strategy.reason}`);

  let uploadType = strategy.type;

  if (onlyGist) {
    uploadType = 'gist';
    log.debug(() => 'Mode: Only Gist (forced)');
  } else if (onlyRepository) {
    uploadType = 'repo';
    log.debug(() => 'Mode: Only Repository (forced)');
  } else if (auto !== false) {
    log.debug(() => 'Mode: Auto (automatic strategy selection)');
  }

  if (dryMode) {
    log.debug(() => `DRY MODE: Upload Type: ${uploadType}`);
    log.debug(() => `DRY MODE: Visibility: ${isPublic ? 'public' : 'private'}`);
    log.debug(() => `DRY MODE: Description: ${description || 'N/A'}`);

    const sharedRepositoryMode =
      uploadType === 'repo' &&
      shouldUseSharedRepositoryMode(filePath, useSharedRepository);
    const repositoryName =
      uploadType !== 'repo'
        ? undefined
        : sharedRepositoryMode
          ? getSharedRepositoryName(isPublic)
          : generateRepoName(filePath);
    // Hashing the file is the only way to know the target folder up front, and
    // dry mode is expected to print the exact path a real upload would use.
    const contentHash =
      uploadType === 'repo'
        ? await generateFileContentHash(filePath)
        : undefined;
    const repositoryPath =
      uploadType === 'repo'
        ? buildLogRepositoryPath(filePath, contentHash)
        : undefined;

    return {
      type: uploadType,
      url:
        uploadType === 'gist'
          ? '[DRY MODE] Would create gist'
          : `[DRY MODE] Would upload to ${repositoryName}/${repositoryPath}`,
      rawUrl: null,
      fileName:
        uploadType === 'gist'
          ? generateGistFileName(filePath)
          : generateStoredLogFileName(filePath),
      repositoryName,
      repositoryPath,
      contentHash,
      fileCount: 1,
      isPublic: isPublic || false,
      dryMode: true,
      deduplicated: false,
    };
  }

  /**
   * Optionally confirm the raw URL really resolves before it is printed
   *
   * Issue #38 reported raw URLs that answered 404; this turns such a report
   * into a checked fact instead of a guess.
   */
  const withRawUrlCheck = async (result) => {
    if (!checkRawUrl || !result?.rawUrl) {
      return result;
    }

    const rawUrlCheck = await checkRawUrlExists(result.rawUrl);
    log.debug(
      () =>
        `Raw URL check: ${rawUrlCheck.ok ? 'reachable' : 'unreachable'}` +
        `${rawUrlCheck.status ? ` (HTTP ${rawUrlCheck.status})` : ''}` +
        `${rawUrlCheck.error ? ` (${rawUrlCheck.error})` : ''}`
    );

    if (!rawUrlCheck.ok) {
      log.warn(
        () =>
          `Raw URL is not reachable${rawUrlCheck.status ? ` (HTTP ${rawUrlCheck.status})` : ''}: ${result.rawUrl}`
      );
    }

    return { ...result, rawUrlCheck };
  };

  if (uploadType === 'gist') {
    try {
      return await withRawUrlCheck(await uploadAsGist(resolvedOptions));
    } catch (gistError) {
      if (isENOSPC(gistError)) {
        throw createENOSPCError('gist upload', gistError);
      }

      if (onlyGist) {
        throw gistError;
      }

      log.warn(
        () =>
          `Gist upload failed: ${gistError.message}. Falling back to repository mode...`
      );

      return withRawUrlCheck(await uploadAsRepo(resolvedOptions));
    }
  }

  try {
    return await withRawUrlCheck(await uploadAsRepo(resolvedOptions));
  } catch (repoError) {
    if (isENOSPC(repoError)) {
      const fileSize = getFileSize(filePath);
      if (fileSize <= GITHUB_GIST_FILE_LIMIT) {
        const enhanced = createENOSPCError('repository upload', repoError);
        enhanced.message +=
          ` Hint: This file (${formatFileSize(fileSize)}) fits in a gist. ` +
          'Try --only-gist to upload without requiring temp disk space.';
        throw enhanced;
      }
      throw createENOSPCError('repository upload', repoError);
    }
    throw repoError;
  }
}

export default {
  uploadLog,
  uploadAsGist,
  uploadAsRepo,
  determineUploadStrategy,
  normalizeFileName,
  resolveLogFilePath,
  generateRepoName,
  generateGistFileName,
  generateUploadedLogFileName,
  generateStoredLogFileName,
  parseFileSize,
  generateLogDirectorySegment,
  generateFileContentHash,
  buildLogRepositoryPath,
  isStoredLogFileName,
  checkRawUrlExists,
  fileExists,
  getFileSize,
  formatFileSize,
  splitFileIntoChunks,
  isENOSPC,
  createENOSPCError,
  GITHUB_GIST_DOCUMENTED_FILE_LIMIT,
  GITHUB_GIST_FILE_LIMIT,
  GITHUB_GIST_WEB_LIMIT,
  GITHUB_REPO_CHUNK_SIZE,
  LOG_CONTENT_HASH_LENGTH,
  DEFAULT_PRIVATE_LOGS_REPOSITORY,
  DEFAULT_PUBLIC_LOGS_REPOSITORY,
};

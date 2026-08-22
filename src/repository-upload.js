#!/usr/bin/env bun

import fs from 'node:fs';
import path from 'node:path';
import {
  buildLogRepositoryPath,
  createDefaultLogger,
  createENOSPCError,
  createWorkDirPath,
  DEFAULT_PRIVATE_LOGS_REPOSITORY,
  DEFAULT_PUBLIC_LOGS_REPOSITORY,
  ensureCommandSucceeded,
  extractGitHubRepoUrl,
  generateCollisionRepoName,
  generateFileContentHash,
  generateRepoName,
  generateStoredLogFileName,
  getCommandExitCode,
  getCommandStream,
  getFileSize,
  GITHUB_REPO_CHUNK_SIZE,
  isENOSPC,
  isRepositoryNameConflict,
  isStoredLogFileName,
  resolveLogFilePath,
  splitFileIntoChunks,
} from './common.js';

const REPOSITORY_METADATA_QUERY =
  '{"defaultBranch": .default_branch, "visibility": .visibility}';
const REPOSITORY_FOLDER_CONTENTS_QUERY =
  'map({name: .name, download_url: .download_url})';

/**
 * Create a command runner bound to a working directory
 *
 * Uses the `cwd` option instead of a `cd <dir> && ...` prefix: command-stream's
 * `cd` builtin changes the working directory of the host process itself
 * (documented in link-foundation/command-stream#50), which breaks any relative
 * path resolved afterwards. Output is mirrored only in verbose mode so that
 * git/gh chatter never pollutes the CLI output.
 *
 * @param {Function} $ - command-stream template tag
 * @param {string} workDir - Absolute working directory for the commands
 * @param {boolean} verbose - Mirror command output when true
 * @returns {Function} command-stream template tag bound to workDir
 */
function createWorkDirRunner($, workDir, verbose = false) {
  return $({ cwd: workDir, mirror: Boolean(verbose), capture: true });
}

/**
 * Initialize a git repository quietly on the requested default branch
 *
 * `git init` prints an "hint: Using 'master' as the name for the initial
 * branch" advice block when `init.defaultBranch` is not configured globally.
 * Passing the config explicitly (plus `-q`) keeps the output clean and makes
 * the initial branch deterministic.
 *
 * @param {Function} $workDir - command-stream tag bound to the work directory
 * @param {string} branchName - Desired initial branch name
 * @returns {Promise<void>}
 */
async function initializeGitRepository($workDir, branchName) {
  ensureCommandSucceeded(
    await $workDir`git -c init.defaultBranch=${branchName} init -q`,
    'initialize temporary git repository'
  );
  // Older git versions ignore init.defaultBranch, so force the branch name.
  ensureCommandSucceeded(
    await $workDir`git branch -M ${branchName}`,
    `rename temporary git branch to ${branchName}`
  );
}

function isGitHubNotFoundError(errorText = '') {
  const normalized = errorText.toLowerCase();
  return normalized.includes('not found') || normalized.includes('http 404');
}

function isMissingRemoteRefError(errorText = '') {
  const normalized = errorText.toLowerCase();
  return (
    normalized.includes("couldn't find remote ref") ||
    normalized.includes('could not find remote branch')
  );
}

export function shouldUseSharedRepositoryMode(
  _filePath,
  useSharedRepository = true
) {
  return useSharedRepository;
}

export function getSharedRepositoryName(isPublic = false) {
  return isPublic
    ? DEFAULT_PUBLIC_LOGS_REPOSITORY
    : DEFAULT_PRIVATE_LOGS_REPOSITORY;
}

function buildGitHubRepositoryUrl(githubUser, repositoryName) {
  return `https://github.com/${githubUser}/${repositoryName}`;
}

function buildGitHubRepositoryTreeUrl(
  githubUser,
  repositoryName,
  branchName,
  repositoryPath
) {
  return `${buildGitHubRepositoryUrl(githubUser, repositoryName)}/tree/${branchName}/${repositoryPath}`;
}

/**
 * Check that a raw URL really serves the uploaded file
 *
 * Issue #38 reported raw URLs that answered 404. This opt-in check (CLI:
 * `--check-raw-url`) turns that class of report into a verifiable fact instead
 * of a guess: it requests a single byte and reports the HTTP status.
 *
 * @param {string} rawUrl - Raw URL to probe
 * @returns {Promise<{ok: boolean, status: number|null, error: string|null}>} Probe result
 */
export async function checkRawUrlExists(rawUrl) {
  if (!rawUrl) {
    return { ok: false, status: null, error: 'no raw URL available' };
  }

  try {
    const response = await fetch(rawUrl, {
      headers: { Range: 'bytes=0-0' },
    });
    return {
      ok: response.ok || response.status === 206,
      status: response.status,
      error: null,
    };
  } catch (error) {
    return { ok: false, status: null, error: error.message };
  }
}

function listUploadedFiles(directoryPath) {
  return fs
    .readdirSync(directoryPath)
    .filter((file) => !file.startsWith('.'))
    .sort();
}

async function getGitHubUsername($quiet) {
  const whoamiResult = ensureCommandSucceeded(
    await $quiet`gh api user --jq .login`,
    'fetch authenticated GitHub username'
  );

  return whoamiResult.stdout.trim();
}

async function getRepositoryMetadata($quiet, githubUser, repositoryName) {
  const result =
    await $quiet`gh api repos/${githubUser}/${repositoryName} --jq ${REPOSITORY_METADATA_QUERY}`;

  if (getCommandExitCode(result) !== 0) {
    if (isGitHubNotFoundError(result.stderr || result.stdout)) {
      return null;
    }
    ensureCommandSucceeded(
      result,
      `read metadata for GitHub repo ${repositoryName}`
    );
  }

  return JSON.parse(result.stdout.trim());
}

async function getRepositoryFolderContents(
  $quiet,
  githubUser,
  repositoryName,
  repositoryPath
) {
  const result =
    await $quiet`gh api repos/${githubUser}/${repositoryName}/contents/${repositoryPath} --jq ${REPOSITORY_FOLDER_CONTENTS_QUERY}`;

  if (getCommandExitCode(result) !== 0) {
    if (isGitHubNotFoundError(result.stderr || result.stdout)) {
      return null;
    }
    ensureCommandSucceeded(
      result,
      `read contents of ${repositoryName}/${repositoryPath}`
    );
  }

  const contents = result.stdout.trim();
  return contents ? JSON.parse(contents) : [];
}

async function ensureSharedRepositoryExists(
  $quiet,
  githubUser,
  repositoryName,
  isPublic,
  log
) {
  const expectedVisibility = isPublic ? 'public' : 'private';
  const existingMetadata = await getRepositoryMetadata(
    $quiet,
    githubUser,
    repositoryName
  );

  if (existingMetadata) {
    if (existingMetadata.visibility !== expectedVisibility) {
      throw new Error(
        `Shared repository ${repositoryName} exists with visibility ${existingMetadata.visibility}, expected ${expectedVisibility}`
      );
    }

    return {
      defaultBranch: existingMetadata.defaultBranch || 'main',
      visibility: existingMetadata.visibility,
      url: buildGitHubRepositoryUrl(githubUser, repositoryName),
    };
  }

  const visibilityFlag = isPublic ? '--public' : '--private';
  log.debug(
    () =>
      `→ Creating shared ${expectedVisibility} GitHub repo: ${repositoryName}`
  );
  const createResult =
    await $quiet`gh repo create ${repositoryName} ${visibilityFlag}`;

  if (
    getCommandExitCode(createResult) !== 0 &&
    isRepositoryNameConflict(createResult.stderr)
  ) {
    const racedMetadata = await getRepositoryMetadata(
      $quiet,
      githubUser,
      repositoryName
    );
    if (racedMetadata) {
      if (racedMetadata.visibility !== expectedVisibility) {
        throw new Error(
          `Shared repository ${repositoryName} exists with visibility ${racedMetadata.visibility}, expected ${expectedVisibility}`
        );
      }

      return {
        defaultBranch: racedMetadata.defaultBranch || 'main',
        visibility: racedMetadata.visibility,
        url: buildGitHubRepositoryUrl(githubUser, repositoryName),
      };
    }
  }

  ensureCommandSucceeded(
    createResult,
    `create ${expectedVisibility} GitHub repo ${repositoryName}`
  );

  return {
    defaultBranch: 'main',
    visibility: expectedVisibility,
    url:
      extractGitHubRepoUrl(createResult.stdout) ||
      buildGitHubRepositoryUrl(githubUser, repositoryName),
  };
}

async function stageRepositoryFiles(filePath, outputDir, log) {
  const stagedFilePath = path.join(
    outputDir,
    generateStoredLogFileName(filePath)
  );

  fs.mkdirSync(outputDir, { recursive: true });
  log.debug(() => `→ Copying file into ${outputDir}...`);
  fs.copyFileSync(filePath, stagedFilePath);

  const fileSize = getFileSize(filePath);
  if (fileSize > GITHUB_REPO_CHUNK_SIZE) {
    log.debug(() => '→ Splitting file into 100MB chunks...');
    log.debug(
      () =>
        `File size: ${fileSize} bytes, chunk size: ${GITHUB_REPO_CHUNK_SIZE} bytes`
    );
    await splitFileIntoChunks(
      stagedFilePath,
      outputDir,
      GITHUB_REPO_CHUNK_SIZE
    );
    log.debug(() => '→ Removing original large file...');
    fs.unlinkSync(stagedFilePath);
  }

  return listUploadedFiles(outputDir);
}

function buildSharedRepositoryResult({
  githubUser,
  repositoryName,
  defaultBranch,
  repositoryPath,
  contents,
  contentHash,
  fileName,
  isPublic,
  workDir,
  deduplicated = false,
}) {
  const fileCount = contents.length;
  const rawUrl = fileCount === 1 ? contents[0]?.download_url || null : null;

  return {
    type: 'repo',
    url: buildGitHubRepositoryTreeUrl(
      githubUser,
      repositoryName,
      defaultBranch,
      repositoryPath
    ),
    rawUrl,
    repositoryName,
    repositoryPath,
    contentHash,
    fileName,
    fileCount,
    isPublic,
    workDir,
    deduplicated,
  };
}

async function uploadAsDedicatedRepo(options = {}) {
  const $ = await getCommandStream(options);
  const { isPublic = false, verbose = false, logger = console } = options;

  if (!options.filePath) {
    throw new Error('filePath is required in options');
  }

  const filePath = resolveLogFilePath(options.filePath);
  const log = createDefaultLogger({ verbose, logger });
  const baseRepositoryName = generateRepoName(filePath);
  const workDir = createWorkDirPath(baseRepositoryName);
  const $workDir = createWorkDirRunner($, workDir, verbose);
  const $quiet = $({ mirror: Boolean(verbose), capture: true });

  try {
    const contentHash = await generateFileContentHash(filePath);
    const repositoryPath = buildLogRepositoryPath(filePath, contentHash);
    log.debug(() => `Content hash: ${contentHash}`);
    log.debug(() => `Repository path: ${repositoryPath}`);

    log.debug(() => `→ Creating work directory: ${workDir}`);
    fs.mkdirSync(workDir, { recursive: true });
    const outputDir = path.join(workDir, repositoryPath);
    await stageRepositoryFiles(filePath, outputDir, log);

    log.debug(() => '→ Initializing git repository...');
    await initializeGitRepository($workDir, 'main');

    log.debug(() => '→ Adding and committing files...');
    ensureCommandSucceeded(
      await $workDir`git add .`,
      'stage repository upload files'
    );
    ensureCommandSucceeded(
      await $workDir`git commit -q -m "Add log file"`,
      'commit repository upload files'
    );

    log.debug(() => 'Getting GitHub user information...');
    const githubUser = await getGitHubUsername($quiet);
    log.debug(() => `GitHub user: ${githubUser}`);

    let repositoryName = baseRepositoryName;
    const visibility = isPublic ? '--public' : '--private';
    let repoCreateResult;

    log.debug(
      () =>
        `→ Creating ${isPublic ? 'public' : 'private'} GitHub repo: ${repositoryName}`
    );
    repoCreateResult =
      await $workDir`gh repo create ${repositoryName} ${visibility} --source=. --push`;

    if (
      getCommandExitCode(repoCreateResult) !== 0 &&
      isRepositoryNameConflict(repoCreateResult.stderr)
    ) {
      repositoryName = generateCollisionRepoName(repositoryName);
      log.warn(
        () =>
          `Repository ${baseRepositoryName} already exists; retrying with ${repositoryName}`
      );
      repoCreateResult =
        await $workDir`gh repo create ${repositoryName} ${visibility} --source=. --push`;
    }

    ensureCommandSucceeded(
      repoCreateResult,
      `create ${isPublic ? 'public' : 'private'} GitHub repo ${repositoryName}`
    );

    const repoUrl =
      extractGitHubRepoUrl(repoCreateResult.stdout) ||
      buildGitHubRepositoryUrl(githubUser, repositoryName);

    log.debug(() => `Repository created successfully: ${repoUrl}`);

    const uploadedFiles = listUploadedFiles(outputDir);
    const fileCount = uploadedFiles.length;
    let rawUrl = null;

    if (fileCount === 1) {
      const singleFileName = `${repositoryPath}/${uploadedFiles[0]}`;
      try {
        log.debug(() => `Fetching raw URL for single file: ${singleFileName}`);
        const contentResult =
          await $quiet`gh api repos/${githubUser}/${repositoryName}/contents/${singleFileName} --jq '.download_url'`;
        rawUrl = contentResult.stdout.trim();

        if (rawUrl) {
          log.debug(() => `Raw URL: ${rawUrl}`);
          if (!isPublic && rawUrl.includes('?token=')) {
            log.debug(
              () =>
                'Note: Raw URL token expires in ~10 minutes for private repositories'
            );
          }
        }
      } catch (apiError) {
        log.debug(() => `Could not fetch raw URL: ${apiError.message}`);
      }
    } else {
      log.debug(
        () => `Repository has ${fileCount} files, skipping single-file raw URL`
      );
    }

    return {
      type: 'repo',
      url: `${repoUrl}/tree/main/${repositoryPath}`,
      rawUrl,
      repositoryName,
      repositoryPath,
      contentHash,
      fileName: generateStoredLogFileName(filePath),
      fileCount,
      isPublic,
      workDir,
      deduplicated: false,
    };
  } catch (error) {
    log.error(() => `Error uploading as repository: ${error.message}`);
    if (fs.existsSync(workDir)) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
    if (isENOSPC(error)) {
      throw createENOSPCError(
        'repository upload (requires temp disk space)',
        error
      );
    }
    throw error;
  }
}

async function uploadAsSharedRepo(options = {}) {
  const $ = await getCommandStream(options);
  const { isPublic = false, verbose = false, logger = console } = options;

  if (!options.filePath) {
    throw new Error('filePath is required in options');
  }

  const filePath = resolveLogFilePath(options.filePath);
  const log = createDefaultLogger({ verbose, logger });
  const repositoryName = getSharedRepositoryName(isPublic);
  const storedFileName = generateStoredLogFileName(filePath);
  const workDir = createWorkDirPath(generateRepoName(filePath));
  const $workDir = createWorkDirRunner($, workDir, verbose);
  const $quiet = $({ mirror: Boolean(verbose), capture: true });
  let repositoryPath;

  try {
    const contentHash = await generateFileContentHash(filePath);
    repositoryPath = buildLogRepositoryPath(filePath, contentHash);
    log.debug(() => `Content hash: ${contentHash}`);
    log.debug(() => `Repository path: ${repositoryPath}`);
    log.debug(() => `Stored file name: ${storedFileName}`);

    const githubUser = await getGitHubUsername($quiet);
    log.debug(() => `GitHub user: ${githubUser}`);

    const sharedRepository = await ensureSharedRepositoryExists(
      $quiet,
      githubUser,
      repositoryName,
      isPublic,
      log
    );
    const defaultBranch = sharedRepository.defaultBranch || 'main';

    const existingContents = await getRepositoryFolderContents(
      $quiet,
      githubUser,
      repositoryName,
      repositoryPath
    );

    // The folder is keyed by content hash, so an existing folder means the very
    // same bytes were already uploaded. The file name is checked as well: an
    // empty or partially written folder (for example an upload that died before
    // pushing) must not be reported as an existing log (issue #38).
    const existingLogFiles = (existingContents || []).filter((entry) =>
      isStoredLogFileName(entry.name, storedFileName)
    );

    if (existingLogFiles.length > 0) {
      log.debug(
        () =>
          `Identical content already uploaded to ${repositoryName}/${repositoryPath}; reusing it`
      );

      return buildSharedRepositoryResult({
        githubUser,
        repositoryName,
        defaultBranch,
        repositoryPath,
        contents: existingLogFiles,
        contentHash,
        fileName: storedFileName,
        isPublic,
        workDir: null,
        deduplicated: true,
      });
    }

    if (existingContents !== null) {
      log.debug(
        () =>
          `Folder ${repositoryPath} exists in ${repositoryName} but does not contain ${storedFileName}; uploading it`
      );
    }

    log.debug(() => `→ Creating work directory: ${workDir}`);
    fs.mkdirSync(workDir, { recursive: true });

    log.debug(() => '→ Initializing git repository...');
    await initializeGitRepository($workDir, defaultBranch);
    ensureCommandSucceeded(
      await $workDir`git remote add origin https://github.com/${githubUser}/${repositoryName}.git`,
      `add remote for shared GitHub repo ${repositoryName}`
    );
    ensureCommandSucceeded(
      await $workDir`git sparse-checkout init --no-cone`,
      'initialize sparse checkout for shared log repository'
    );
    ensureCommandSucceeded(
      await $workDir`git sparse-checkout add ${repositoryPath}`,
      `prepare sparse checkout path ${repositoryPath}`
    );

    const fetchResult =
      await $workDir`git fetch -q --depth 1 --filter=blob:none origin ${defaultBranch}`;
    if (getCommandExitCode(fetchResult) === 0) {
      ensureCommandSucceeded(
        await $workDir`git checkout -q -B ${defaultBranch} FETCH_HEAD`,
        `check out ${defaultBranch} from shared GitHub repo ${repositoryName}`
      );
    } else if (
      isMissingRemoteRefError(fetchResult.stderr || fetchResult.stdout)
    ) {
      log.debug(
        () =>
          `Shared repository ${repositoryName} does not have ${defaultBranch} yet; continuing with a fresh branch`
      );
    } else {
      ensureCommandSucceeded(
        fetchResult,
        `fetch ${defaultBranch} from shared GitHub repo ${repositoryName}`
      );
    }

    const outputDir = path.join(workDir, repositoryPath);
    await stageRepositoryFiles(filePath, outputDir, log);

    log.debug(() => '→ Adding and committing files...');
    ensureCommandSucceeded(
      await $workDir`git add .`,
      'stage shared repository upload files'
    );
    ensureCommandSucceeded(
      await $workDir`git commit -q -m "Add log file"`,
      'commit shared repository upload files'
    );
    ensureCommandSucceeded(
      await $workDir`git push -q -u origin ${defaultBranch}`,
      `push shared repository upload to ${repositoryName}`
    );

    const uploadedContents =
      (await getRepositoryFolderContents(
        $quiet,
        githubUser,
        repositoryName,
        repositoryPath
      )) ||
      listUploadedFiles(outputDir).map((name) => ({
        name,
        download_url: null,
      }));

    return buildSharedRepositoryResult({
      githubUser,
      repositoryName,
      defaultBranch,
      repositoryPath,
      contents: uploadedContents,
      contentHash,
      fileName: storedFileName,
      isPublic,
      workDir,
      deduplicated: false,
    });
  } catch (error) {
    log.error(() => `Error uploading as shared repository: ${error.message}`);
    if (fs.existsSync(workDir)) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
    if (isENOSPC(error)) {
      throw createENOSPCError(
        'repository upload (requires temp disk space)',
        error
      );
    }
    throw error;
  }
}

/**
 * Upload a file as a GitHub repository (with splitting if needed)
 *
 * Repository-mode uploads use the shared visibility repositories (`private-logs` or
 * `public-logs`) by default. The legacy dedicated-repository mode remains
 * available through the `useSharedRepository` option.
 *
 * @param {Object} options - Upload options
 * @param {string} options.filePath - Path to the file to upload
 * @param {boolean} options.useSharedRepository - Use shared log repositories for repository-mode uploads (default: true)
 * @returns {Promise<Object>} Repository information including URL
 */
export function uploadAsRepo(options = {}) {
  const { filePath, useSharedRepository = true } = options;

  if (!filePath) {
    throw new Error('filePath is required in options');
  }

  if (shouldUseSharedRepositoryMode(filePath, useSharedRepository)) {
    return uploadAsSharedRepo(options);
  }

  return uploadAsDedicatedRepo(options);
}

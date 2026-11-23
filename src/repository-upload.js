#!/usr/bin/env bun

import { uploadSourcePath, withSanitizedUpload } from './sanitization.js';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildLogRepositoryPath,
  createDefaultLogger,
  createENOSPCError,
  createWorkDirPath,
  ensureCommandSucceeded,
  extractGitHubRepoUrl,
  generateCollisionRepoName,
  generateFileContentHash,
  generateRepoName,
  getCommandExitCode,
  getCommandStream,
  getFileSize,
  isENOSPC,
  isRepositoryNameConflict,
  resolveChunkSize,
  resolveLogFilePath,
} from './common.js';
import { pushWithRetry } from './git-push.js';
import {
  buildSharedRepositoryResult,
  createWorkDirRunner,
  ensureSharedRepositoryExists,
  getGitHubUsername,
  getRepositoryFolderContents,
  getRepositoryMetadata,
  getSharedRepositoryName,
  initializeGitRepository,
  isMissingRemoteRefError,
  shouldUseSharedRepositoryMode,
  buildGitHubRepositoryUrl,
} from './repository-remote.js';
export {
  getSharedRepositoryName,
  shouldUseSharedRepositoryMode,
} from './repository-remote.js';
import { publishTextParts, textPartLayout } from './repository-text-push.js';
import {
  isStreamingTextCandidate,
  planTextUpload,
} from './text-upload-plan.js';
import {
  getFileUploadInfo,
  getUploadInfoForType,
  isStoredFileName,
  stageUploadFiles,
} from './file-upload.js';
import {
  resolveRepositoryTarget,
  validateRepositoryBranch,
} from './repository-target.js';

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

function stageRepositoryFiles(filePath, outputDir, log, chunkSize, info) {
  log.debug(() =>
    info.archiveFormat
      ? `→ Creating ${info.archiveFormat} archive; stored parts are limited to ${chunkSize} bytes...`
      : `→ Staging text with chunks of at most ${chunkSize} bytes...`
  );
  return stageUploadFiles(filePath, outputDir, chunkSize, info);
}

async function ensureDedicatedTextRepository(
  $quiet,
  githubUser,
  baseName,
  contentHash,
  isPublic
) {
  const description = `gh-upload-log content ${contentHash}`;
  const visibility = isPublic ? 'public' : 'private';
  const visibilityFlag = `--${visibility}`;
  // Keep the usual base name. The content-specific fallback lets interrupted
  // uploads find the same dedicated repository after a name collision.
  for (const repositoryName of [
    baseName,
    `${baseName.slice(0, 83)}-${contentHash}`,
  ]) {
    const metadata = await getRepositoryMetadata(
      $quiet,
      githubUser,
      repositoryName,
      { includeDescription: true }
    );
    if (metadata) {
      if (
        metadata.visibility === visibility &&
        metadata.description === description
      ) {
        return repositoryName;
      }
      continue;
    }
    const result =
      await $quiet`gh repo create ${repositoryName} ${visibilityFlag} --description ${description}`;
    if (getCommandExitCode(result) === 0) {
      return repositoryName;
    }
    if (isRepositoryNameConflict(result.stderr)) {
      const raced = await getRepositoryMetadata(
        $quiet,
        githubUser,
        repositoryName,
        { includeDescription: true }
      );
      if (
        raced?.visibility === visibility &&
        raced.description === description
      ) {
        return repositoryName;
      }
      continue;
    }
    ensureCommandSucceeded(
      result,
      `create dedicated GitHub repo ${repositoryName}`
    );
  }
  throw new Error(`Could not reserve a dedicated repository for ${baseName}`);
}

export async function uploadPlannedTextRepo(options, plan) {
  const { source, contentHash, sanitization, parts } = plan;
  const { isPublic = false, verbose = false } = options;
  const log = createDefaultLogger(options);
  const info = getUploadInfoForType(source, 'text');
  const { fileName } = info;
  const repositoryPath = buildLogRepositoryPath(source, contentHash);
  const target = resolveRepositoryTarget(options);
  const baseName = generateRepoName(source);
  const shared =
    target ||
    shouldUseSharedRepositoryMode(source, options.useSharedRepository);
  const $ = await getCommandStream(options);
  const $quiet = $({ mirror: verbose, capture: true });
  const githubUser = target?.owner || (await getGitHubUsername($quiet));
  const repositoryName = shared
    ? target?.repositoryName || getSharedRepositoryName(isPublic)
    : await ensureDedicatedTextRepository(
        $quiet,
        githubUser,
        baseName,
        contentHash,
        isPublic
      );
  const metadata = target
    ? await getRepositoryMetadata($quiet, githubUser, repositoryName)
    : shared
      ? await ensureSharedRepositoryExists(
          $quiet,
          githubUser,
          repositoryName,
          isPublic,
          log
        )
      : { defaultBranch: 'main', visibility: isPublic ? 'public' : 'private' };
  if (!metadata) {
    throw new Error(
      `Existing GitHub repository ${githubUser}/${repositoryName} was not found or is inaccessible`
    );
  }
  const defaultBranch = validateRepositoryBranch(
    target?.branch || metadata.defaultBranch || 'main'
  );
  const contents = () =>
    getRepositoryFolderContents(
      $quiet,
      githubUser,
      repositoryName,
      repositoryPath,
      defaultBranch
    );
  function result(entries, workDir, deduplicated, indexName) {
    const repo = buildSharedRepositoryResult({
      githubUser,
      repositoryName,
      defaultBranch,
      repositoryPath,
      contents: entries,
      contentHash,
      fileName,
      isPublic: metadata.visibility === 'public',
      workDir,
      deduplicated,
      info,
    });
    const indexUrl = indexName
      ? `${repo.url.replace(`/tree/`, `/blob/`)}/${encodeURIComponent(indexName)}`
      : undefined;
    return { ...repo, indexUrl, sanitization };
  }

  const layout = textPartLayout(fileName, parts.length);
  const existing = (await contents()) || [];
  const files = existing.filter((entry) => isStoredFileName(entry.name, info));
  const indexName = existing.some((entry) => entry.name === layout.indexName)
    ? layout.indexName
    : null;
  if (
    files.length &&
    !existing.some((entry) => entry.name === layout.pendingName) &&
    (files.some((entry) => entry.name === fileName) ||
      // The Contents API truncates at 1,000 entries. Use the Git tree below
      // when the listing may be incomplete.
      (existing.length < 1000 &&
        (indexName ||
          existing.some((entry) => entry.name === `.${fileName}.complete`) ||
          (files.every((entry) => Number.isSafeInteger(entry.size)) &&
            files.reduce((total, entry) => total + entry.size, 0) ===
              sanitization.outputBytes))))
  ) {
    return result(files, null, true, indexName);
  }

  const workDir = fs.mkdtempSync(`${createWorkDirPath(baseName)}-`);
  const run = createWorkDirRunner($, workDir, verbose);
  const input = (stdin) =>
    $({ cwd: workDir, mirror: false, capture: true, stdin });
  try {
    ensureCommandSucceeded(
      await run`git -c init.defaultBranch=${defaultBranch} init -q --object-format=sha1`,
      'initialize streaming repository upload'
    );
    ensureCommandSucceeded(
      await run`git symbolic-ref HEAD ${`refs/heads/${defaultBranch}`}`,
      'set streaming upload branch'
    );
    const config = [
      ['gc.auto', '0'],
      ['maintenance.auto', 'false'],
      ['pack.window', '0'],
      ['pack.threads', '1'],
      ...(target
        ? [
            ['credential.https://github.com.helper', ''],
            ['credential.https://github.com.helper', '!gh auth git-credential'],
            ['user.name', 'gh-upload-log'],
            ['user.email', 'gh-upload-log@users.noreply.github.com'],
          ]
        : []),
    ];
    for (const [key, value] of config) {
      ensureCommandSucceeded(
        await run`git config --local --add ${key} ${value}`,
        `configure streaming repository upload ${key}`
      );
    }
    ensureCommandSucceeded(
      await run`git remote add origin https://github.com/${githubUser}/${repositoryName}.git`,
      'add streaming repository remote'
    );
    const branch = target ? `refs/heads/${defaultBranch}` : defaultBranch;
    const fetchResult =
      await run`git fetch -q --depth 1 --filter=blob:none origin ${branch}`;
    const newBranch = isMissingRemoteRefError(
      fetchResult.stderr || fetchResult.stdout
    );
    if (newBranch && target) {
      throw new Error(
        `Existing branch ${defaultBranch} was not found in ${githubUser}/${repositoryName}`
      );
    }
    if (!newBranch) {
      ensureCommandSucceeded(
        fetchResult,
        `fetch upload branch ${defaultBranch}`
      );
    }

    const published = await publishTextParts({
      options,
      plan,
      info,
      workDir,
      repositoryPath,
      repositoryName,
      defaultBranch,
      log,
      run,
      input,
      newBranch,
    });
    const uploaded = published.names.map((name) => ({ name }));
    if (uploaded.length === 1) {
      uploaded[0] =
        (await contents())?.find((entry) => entry.name === fileName) ||
        uploaded[0];
    }
    if (published.deduplicated) {
      fs.rmSync(workDir, { recursive: true, force: true });
      return result(uploaded, null, true, published.indexName);
    }
    return result(uploaded, workDir, false, published.indexName);
  } catch (error) {
    fs.rmSync(workDir, { recursive: true, force: true });
    if (isENOSPC(error)) {
      throw createENOSPCError('streaming repository upload', error);
    }
    throw error;
  }
}

async function uploadAsDedicatedRepo(options = {}) {
  const $ = await getCommandStream(options);
  const { isPublic = false, verbose = false, logger = console } = options;

  if (!options.filePath) {
    throw new Error('filePath is required in options');
  }

  const filePath = resolveLogFilePath(options.filePath);
  const chunkSize = resolveChunkSize(options.chunkSize);
  const info = getFileUploadInfo(filePath, uploadSourcePath(options));
  const log = createDefaultLogger({ verbose, logger });
  const baseRepositoryName = generateRepoName(uploadSourcePath(options));
  const workDir = createWorkDirPath(baseRepositoryName);
  const $workDir = createWorkDirRunner($, workDir, verbose);
  const $quiet = $({ mirror: Boolean(verbose), capture: true });

  try {
    const contentHash = await generateFileContentHash(filePath);
    const repositoryPath = buildLogRepositoryPath(
      uploadSourcePath(options),
      contentHash
    );
    log.debug(() => `Content hash: ${contentHash}`);
    log.debug(() => `Repository path: ${repositoryPath}`);

    log.debug(() => `→ Creating work directory: ${workDir}`);
    fs.mkdirSync(workDir, { recursive: true });
    const outputDir = path.join(workDir, repositoryPath);
    await stageRepositoryFiles(filePath, outputDir, log, chunkSize, info);

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
      ...info,
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
  const chunkSize = resolveChunkSize(options.chunkSize);
  const info = getFileUploadInfo(filePath, uploadSourcePath(options));
  const log = createDefaultLogger({ verbose, logger });
  const target = resolveRepositoryTarget(options);
  const repositoryName =
    target?.repositoryName || getSharedRepositoryName(isPublic);
  const storedFileName = info.fileName;
  const workDir = createWorkDirPath(
    generateRepoName(uploadSourcePath(options))
  );
  const $workDir = createWorkDirRunner($, workDir, verbose);
  const $quiet = $({ mirror: Boolean(verbose), capture: true });
  let repositoryPath;

  try {
    const contentHash = await generateFileContentHash(filePath);
    repositoryPath = buildLogRepositoryPath(
      uploadSourcePath(options),
      contentHash
    );
    log.debug(() => `Content hash: ${contentHash}`);
    log.debug(() => `Repository path: ${repositoryPath}`);
    log.debug(() => `Stored file name: ${storedFileName}`);

    const githubUser = target?.owner || (await getGitHubUsername($quiet));
    log.debug(
      () =>
        `Repository owner: ${githubUser}${target ? ' (explicit target; skipping user lookup)' : ''}`
    );

    const sharedRepository = target
      ? await getRepositoryMetadata($quiet, githubUser, repositoryName)
      : await ensureSharedRepositoryExists(
          $quiet,
          githubUser,
          repositoryName,
          isPublic,
          log
        );
    if (!sharedRepository) {
      throw new Error(
        `Existing GitHub repository ${githubUser}/${repositoryName} was not found or is inaccessible`
      );
    }
    const defaultBranch = validateRepositoryBranch(
      target?.branch || sharedRepository.defaultBranch || 'main'
    );
    const repositoryIsPublic = target
      ? sharedRepository.visibility === 'public'
      : isPublic;
    log.debug(
      () =>
        `Upload target: ${githubUser}/${repositoryName}, branch: ${defaultBranch}, visibility: ${sharedRepository.visibility}`
    );

    const existingContents = await getRepositoryFolderContents(
      $quiet,
      githubUser,
      repositoryName,
      repositoryPath,
      target ? defaultBranch : undefined
    );

    // The folder is keyed by content hash, so an existing folder means the very
    // same bytes were already uploaded. The file name is checked as well: an
    // empty or partially written folder (for example an upload that died before
    // pushing) must not be reported as an existing log (issue #38).
    const existingLogFiles = (existingContents || []).filter((entry) =>
      isStoredFileName(entry.name, info)
    );

    const completionFileName = `.${storedFileName}.complete`;
    const pendingFileName = `.${storedFileName}.pending`;
    const hasPendingUpload = (existingContents || []).some(
      (entry) => entry.name === pendingFileName
    );
    // Single-file uploads were atomic before chunk pushes were introduced.
    // Chunk uploads only become complete when their final commit adds a marker.
    // Size totals recognize legacy uploads only when no pending marker exists:
    // resuming with another chunk size can leave mixed parts with the same total.
    const isComplete =
      existingLogFiles.some((entry) => entry.name === storedFileName) ||
      (existingLogFiles.length > 0 &&
        !hasPendingUpload &&
        ((existingContents || []).some(
          (entry) => entry.name === completionFileName
        ) ||
          (info.fileType === 'text' &&
            existingLogFiles.every((entry) =>
              Number.isSafeInteger(entry.size)
            ) &&
            existingLogFiles.reduce((total, entry) => total + entry.size, 0) ===
              getFileSize(filePath))));
    if (isComplete) {
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
        isPublic: repositoryIsPublic,
        workDir: null,
        deduplicated: true,
        info,
      });
    }

    if (existingContents !== null) {
      log.debug(
        () =>
          `Folder ${repositoryPath} exists in ${repositoryName} but does not contain a complete ${storedFileName}; uploading it`
      );
    }

    log.debug(() => `→ Creating work directory: ${workDir}`);
    fs.mkdirSync(workDir, { recursive: true });

    log.debug(() => '→ Initializing git repository...');
    await initializeGitRepository($workDir, defaultBranch);
    if (target) {
      // Keep token-based authentication and commit identity local to the
      // disposable checkout; installation tokens have no user identity.
      for (const [key, value] of [
        ['credential.https://github.com.helper', ''],
        ['credential.https://github.com.helper', '!gh auth git-credential'],
        ['user.name', 'gh-upload-log'],
        ['user.email', 'gh-upload-log@users.noreply.github.com'],
      ]) {
        ensureCommandSucceeded(
          await $workDir`git config --local --add ${key} ${value}`,
          `configure repository upload ${key}`
        );
      }
    }
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

    let newBranch = false;
    const remoteBranch = target ? `refs/heads/${defaultBranch}` : defaultBranch;
    const fetchResult =
      await $workDir`git fetch -q --depth 1 --filter=blob:none origin ${remoteBranch}`;
    if (getCommandExitCode(fetchResult) === 0) {
      ensureCommandSucceeded(
        await $workDir`git checkout -q -B ${defaultBranch} FETCH_HEAD`,
        `check out ${defaultBranch} from shared GitHub repo ${repositoryName}`
      );
    } else if (
      isMissingRemoteRefError(fetchResult.stderr || fetchResult.stdout)
    ) {
      if (target) {
        throw new Error(
          `Existing branch ${defaultBranch} was not found in ${githubUser}/${repositoryName}`
        );
      }
      newBranch = true;
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
    // Keep future chunks outside the working tree while fetch/rebase runs.
    const stagingDir = path.join(workDir, '.git', 'upload-staging');
    const files = await stageRepositoryFiles(
      filePath,
      stagingDir,
      log,
      chunkSize,
      info
    );
    fs.mkdirSync(outputDir, { recursive: true });
    for (const [index, name] of files.entries()) {
      log.debug(
        () =>
          `→ Committing and pushing chunk ${index + 1}/${files.length}: ${name}`
      );
      fs.renameSync(path.join(stagingDir, name), path.join(outputDir, name));
      if (files.length > 1 && index === 0) {
        fs.writeFileSync(
          path.join(outputDir, pendingFileName),
          `${contentHash}\n`
        );
        ensureCommandSucceeded(
          await $workDir`git add -- ${`${repositoryPath}/${pendingFileName}`}`,
          'mark shared repository upload as pending'
        );
      }
      const relativeFilePath = `${repositoryPath}/${name}`;
      ensureCommandSucceeded(
        await $workDir`git add -- ${relativeFilePath}`,
        'stage shared repository upload chunk'
      );
      if (index === files.length - 1) {
        fs.rmSync(path.join(outputDir, pendingFileName), { force: true });
        // A resumed upload may use a different chunk size. Remove obsolete
        // parts only when all replacement chunks have reached the remote.
        for (const oldName of listUploadedFiles(outputDir)) {
          if (isStoredFileName(oldName, info) && !files.includes(oldName)) {
            fs.unlinkSync(path.join(outputDir, oldName));
          }
        }
        if (files.length > 1) {
          fs.writeFileSync(
            path.join(outputDir, completionFileName),
            `${contentHash}\n`
          );
        } else {
          fs.rmSync(path.join(outputDir, completionFileName), { force: true });
        }
        ensureCommandSucceeded(
          await $workDir`git add -A -- ${repositoryPath}`,
          'stage completed shared repository upload'
        );
      }
      const diff = await $workDir`git diff --cached --quiet`;
      if (getCommandExitCode(diff) === 0) {
        log.debug(
          () => `Chunk ${name} already matches the remote; skipping it`
        );
        continue;
      }
      if (getCommandExitCode(diff) !== 1) {
        ensureCommandSucceeded(diff, 'check staged shared repository upload');
      }
      ensureCommandSucceeded(
        await $workDir`git commit -q -m "Add log file"`,
        'commit shared repository upload chunk'
      );
      await pushWithRetry($workDir, {
        ...options,
        defaultBranch,
        repositoryName,
        log,
        newBranch,
      });
      newBranch = false;
    }

    const uploadedContents = await getRepositoryFolderContents(
      $quiet,
      githubUser,
      repositoryName,
      repositoryPath,
      target ? defaultBranch : undefined
    );
    const uploadedFiles = files.map(
      (name) =>
        (uploadedContents || []).find((entry) => entry.name === name) || {
          name,
          download_url: null,
        }
    );

    return buildSharedRepositoryResult({
      githubUser,
      repositoryName,
      defaultBranch,
      repositoryPath,
      contents: uploadedFiles,
      contentHash,
      fileName: storedFileName,
      isPublic: repositoryIsPublic,
      workDir,
      deduplicated: false,
      info,
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
 * @param {number} options.chunkSize - Maximum chunk size in bytes (default: 100MB)
 * @param {number} options.pushRetries - Extra transient shared-repository push attempts (default: 2)
 * @param {number} options.pushRetryDelayMs - Initial backoff in milliseconds (default: 1000)
 * @param {boolean} options.useSharedRepository - Use shared log repositories for repository-mode uploads (default: true)
 * @param {string} options.repository - Existing repository (OWNER/REPO), overriding useSharedRepository
 * @param {string} options.branch - Existing branch in the target repository (default: its default branch)
 * @returns {Promise<Object>} Repository information including URL
 */
export async function uploadAsRepo(options = {}) {
  if (isStreamingTextCandidate(options)) {
    resolveRepositoryTarget(options);
    return uploadPlannedTextRepo(options, await planTextUpload(options));
  }
  return withSanitizedUpload(options, uploadSanitizedRepo);
}

function uploadSanitizedRepo(options) {
  const { filePath, useSharedRepository = true } = options;

  if (!filePath) {
    throw new Error('filePath is required in options');
  }

  const target = resolveRepositoryTarget(options);
  if (target || shouldUseSharedRepositoryMode(filePath, useSharedRepository)) {
    return uploadAsSharedRepo(options);
  }

  return uploadAsDedicatedRepo(options);
}

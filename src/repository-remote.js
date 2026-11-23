import {
  DEFAULT_PRIVATE_LOGS_REPOSITORY,
  DEFAULT_PUBLIC_LOGS_REPOSITORY,
  ensureCommandSucceeded,
  extractGitHubRepoUrl,
  getCommandExitCode,
  isRepositoryNameConflict,
} from './common.js';

const REPOSITORY_METADATA_QUERY =
  '{"defaultBranch": .default_branch, "visibility": .visibility}';
const REPOSITORY_METADATA_WITH_DESCRIPTION_QUERY =
  '{"defaultBranch": .default_branch, "visibility": .visibility, "description": .description}';
const REPOSITORY_FOLDER_CONTENTS_QUERY =
  'map({name: .name, size: .size, download_url: .download_url})';

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
export function createWorkDirRunner($, workDir, verbose = false) {
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
export async function initializeGitRepository($workDir, branchName) {
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

export function isMissingRemoteRefError(errorText = '') {
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

export function buildGitHubRepositoryUrl(githubUser, repositoryName) {
  return `https://github.com/${githubUser}/${repositoryName}`;
}

function encodePathSegments(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function buildGitHubRepositoryViewUrl(
  githubUser,
  repositoryName,
  branchName,
  repositoryPath,
  fileName
) {
  const root = buildGitHubRepositoryUrl(githubUser, repositoryName);
  const path = encodePathSegments(`${branchName}/${repositoryPath}`);
  return fileName
    ? `${root}/blob/${path}/${encodeURIComponent(fileName)}`
    : `${root}/tree/${path}`;
}

export async function getGitHubUsername($quiet) {
  const whoamiResult = ensureCommandSucceeded(
    await $quiet`gh api user --jq .login`,
    'fetch authenticated GitHub username'
  );

  return whoamiResult.stdout.trim();
}

export async function getRepositoryMetadata(
  $quiet,
  githubUser,
  repositoryName,
  { includeDescription = false } = {}
) {
  const query = includeDescription
    ? REPOSITORY_METADATA_WITH_DESCRIPTION_QUERY
    : REPOSITORY_METADATA_QUERY;
  const result =
    await $quiet`gh api repos/${githubUser}/${repositoryName} --jq ${query}`;

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

export async function getRepositoryFolderContents(
  $quiet,
  githubUser,
  repositoryName,
  repositoryPath,
  branch
) {
  const folder = encodePathSegments(repositoryPath);
  const result = branch
    ? await $quiet`gh api repos/${githubUser}/${repositoryName}/contents/${folder} --method GET -f ref=${branch} --jq ${REPOSITORY_FOLDER_CONTENTS_QUERY}`
    : await $quiet`gh api repos/${githubUser}/${repositoryName}/contents/${folder} --jq ${REPOSITORY_FOLDER_CONTENTS_QUERY}`;

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

export async function ensureSharedRepositoryExists(
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

export function buildSharedRepositoryResult({
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
  info,
}) {
  const fileCount = contents.length;
  const rawUrl = fileCount === 1 ? contents[0]?.download_url || null : null;

  return {
    type: 'repo',
    ...info,
    url: buildGitHubRepositoryViewUrl(
      githubUser,
      repositoryName,
      defaultBranch,
      repositoryPath
    ),
    rawUrl,
    repositoryName,
    repositoryFullName: `${githubUser}/${repositoryName}`,
    branch: defaultBranch,
    repositoryPath,
    contentHash,
    fileName,
    fileCount,
    isPublic,
    workDir,
    deduplicated,
  };
}

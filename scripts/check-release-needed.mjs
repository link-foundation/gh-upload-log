#!/usr/bin/env bun

/**
 * Decide whether the release job has anything to release, from every
 * artifact rather than from the changesets alone (CI-CD-BEST-PRACTICES
 * principle 9; the pipeline template's check-release-needed.mjs).
 *
 * The version commit consumes the changesets. A run that died after it, or
 * after the publish, used to leave the next push with nothing to do: the
 * missing npm package or GitHub release was never created. Without
 * changesets, the current version is released again without a bump when any
 * npm name or the GitHub release is missing. A lookup that fails is
 * "unknown", which never releases.
 *
 * Usage: bun scripts/check-release-needed.mjs
 * Environment: HAS_CHANGESETS, GITHUB_REPOSITORY, GH_TOKEN
 * Outputs: should_release, skip_bump
 */

import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isVersionPublished } from './publish-to-npm.mjs';

function appendOutput(key, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${key}=${value}\n`);
  }
}

/** Only a definitive 404 means a release is missing; other answers are unknown. */
export async function githubReleaseExists(
  tag,
  {
    repository = process.env.GITHUB_REPOSITORY,
    apiUrl = process.env.GITHUB_API_URL || 'https://api.github.com',
    token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
    fetchFn = fetch,
    logger = console,
  } = {}
) {
  try {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '')) {
      throw new Error('GITHUB_REPOSITORY is unavailable');
    }
    const response = await fetchFn(
      `${apiUrl.replace(/\/$/, '')}/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: globalThis.AbortSignal.timeout(15_000),
      }
    );
    if (response.status === 404) {
      return false;
    }
    if (!response.ok) {
      throw new Error(`GitHub answered HTTP ${response.status}`);
    }
    const release = await response.json();
    if (release.tag_name !== tag) {
      throw new Error('Malformed GitHub release response');
    }
    return true;
  } catch (error) {
    logger.log(
      `::warning::GitHub release state unknown for ${tag}: ${error.message}`
    );
    return null;
  }
}

/**
 * @returns {Promise<{shouldRelease: boolean, skipBump: boolean}>}
 */
export async function checkReleaseNeeded({
  hasChangesets,
  names,
  version,
  isPublished = isVersionPublished,
  releaseExists = githubReleaseExists,
  setOutput = appendOutput,
  logger = console,
}) {
  const decide = (shouldRelease, skipBump, message) => {
    logger.log(message);
    setOutput('should_release', String(shouldRelease));
    setOutput('skip_bump', String(skipBump));
    return { shouldRelease, skipBump };
  };

  if (hasChangesets) {
    return decide(true, false, 'Changesets found: releasing a new version');
  }

  const missing = [];
  for (const name of names) {
    try {
      if (!(await isPublished(name, version))) {
        missing.push(name);
      }
    } catch (error) {
      return decide(
        false,
        false,
        `::notice::No release: npm state of ${name}@${version} is unknown (${error.message})`
      );
    }
  }
  if (missing.length > 0) {
    return decide(
      true,
      true,
      `::notice::${missing.map((name) => `${name}@${version}`).join(', ')} missing on npm: releasing ${version} again without a bump`
    );
  }

  const tag = `v${version}`;
  const exists = await releaseExists(tag);
  if (exists === false) {
    return decide(
      true,
      true,
      `::notice::${tag} is on npm but has no GitHub release: creating it without a bump`
    );
  }
  return decide(
    false,
    false,
    exists === null
      ? `::notice::No release: the GitHub release state of ${tag} is unknown`
      : `::notice::No release: no changesets, and ${version} is already on npm and GitHub`
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  checkReleaseNeeded({
    hasChangesets: process.env.HAS_CHANGESETS === 'true',
    names: [pkg.name, ...(pkg.publishAliases || [])],
    version: pkg.version,
  }).catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  });
}

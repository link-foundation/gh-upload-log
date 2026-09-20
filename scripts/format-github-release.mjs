#!/usr/bin/env bun

/**
 * Format GitHub release notes using the format-release-notes.mjs script
 * Usage: bun scripts/format-github-release.mjs --release-version <version> --repository <repository> --commit-sha <commit_sha>
 *   release-version: Version number (e.g., 1.0.0)
 *   repository: GitHub repository (e.g., owner/repo)
 *   commit_sha: Commit SHA for PR detection
 *
 * Uses link-foundation libraries:
 * - command-stream: Modern shell command execution with streaming support
 * - lino-arguments: Unified configuration from CLI args, env vars, and .lenv files
 */

import { $ } from 'command-stream';
import { makeConfig } from 'lino-arguments';
import { ensureCommandSucceeded } from '../src/common.js';

if (typeof $ !== 'function') {
  throw new TypeError('command-stream did not export a callable `$` function');
}

// Parse CLI arguments using lino-arguments
// Note: Using --release-version instead of --version to avoid conflict with yargs' built-in --version flag
const config = makeConfig({
  yargs: ({ yargs, getenv }) =>
    yargs
      .option('release-version', {
        type: 'string',
        default: getenv('VERSION', ''),
        describe: 'Version number (e.g., 1.0.0)',
      })
      .option('repository', {
        type: 'string',
        default: getenv('REPOSITORY', ''),
        describe: 'GitHub repository (e.g., owner/repo)',
      })
      .option('commit-sha', {
        type: 'string',
        default: getenv('COMMIT_SHA', ''),
        describe: 'Commit SHA for PR detection',
      }),
});

const { releaseVersion: version, repository, commitSha } = config;

if (!version || !repository || !commitSha) {
  console.error('Error: Missing required arguments');
  console.error(
    'Usage: bun scripts/format-github-release.mjs --release-version <version> --repository <repository> --commit-sha <commit_sha>'
  );
  process.exit(1);
}

const tag = `v${version}`;

try {
  // Get the release ID for this version
  let releaseId = '';
  try {
    const result =
      await $`gh api "repos/${repository}/releases/tags/${tag}" --jq '.id'`.run(
        { capture: true }
      );
    ensureCommandSucceeded(result, `find GitHub release ${tag}`);
    releaseId = result.stdout.trim();
  } catch {
    console.log(`\u26A0\uFE0F Could not find release for ${tag}`);
    process.exit(0);
  }

  if (releaseId) {
    console.log(`Formatting release notes for ${tag}...`);
    // Pass the trigger commit SHA for PR detection
    // This allows proper PR lookup even if the changelog doesn't have a commit hash
    const formatterResult =
      await $`${process.execPath} scripts/format-release-notes.mjs --release-id "${releaseId}" --release-version "${tag}" --repository "${repository}" --commit-sha "${commitSha}"`.run();
    ensureCommandSucceeded(formatterResult, `format release notes for ${tag}`);
    console.log(`\u2705 Formatted release notes for ${tag}`);
  }
} catch (error) {
  console.error('Error formatting release:', error.message);
  process.exit(1);
}

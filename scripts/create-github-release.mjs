#!/usr/bin/env bun

/**
 * Create GitHub Release from CHANGELOG.md
 * Usage: node scripts/create-github-release.mjs --release-version <version> --repository <repository>
 *   release-version: Version number (e.g., 1.0.0)
 *   repository: GitHub repository (e.g., owner/repo)
 *
 * Uses link-foundation libraries:
 * - command-stream: Modern shell command execution with streaming support
 * - lino-arguments: Unified configuration from CLI args, env vars, and .lenv files
 */

import { readFileSync } from 'fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { $ } from 'command-stream';
import { makeConfig } from 'lino-arguments';
import { ensureCommandSucceeded } from '../src/common.js';
import { extractChangelogSection } from './format-release-notes-helpers.mjs';

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
      .option('gh-command', {
        type: 'string',
        default: getenv('GH_COMMAND', 'gh'),
        describe: 'GitHub CLI executable',
      })
      .option('target-commit', {
        type: 'string',
        default: getenv('TARGET_COMMIT', ''),
        describe: 'Exact version commit for a missing release tag',
      }),
});

const { releaseVersion: version, repository, ghCommand, targetCommit } = config;

if (!version || !repository) {
  console.error('Error: Missing required arguments');
  console.error(
    'Usage: node scripts/create-github-release.mjs --release-version <version> --repository <repository>'
  );
  process.exit(1);
}

const tag = `v${version}`;

console.log(`Creating GitHub release for ${tag}...`);

try {
  // Read CHANGELOG.md
  const changelog = readFileSync('./CHANGELOG.md', 'utf8');

  const releaseNotes =
    extractChangelogSection(changelog, version) || `Release ${version}`;

  // Create release using GitHub API with JSON input
  // This avoids shell escaping issues that occur when passing text via command-line arguments
  // (Previously caused apostrophes like "didn't" to appear as "didn'''" in releases).
  // The payload is a file, not stdin: under Bun, command-stream <= 0.11.1
  // reports exit code 0 for a failed command run with `stdin`, so a refused
  // release looked created (experiments/issue-59-command-stream-stdin-exit-code.mjs).
  const payload = JSON.stringify({
    tag_name: tag,
    name: version,
    body: releaseNotes,
    ...(targetCommit ? { target_commitish: targetCommit } : {}),
  });
  const payloadDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'gh-upload-log-release-')
  );
  const payloadPath = path.join(payloadDirectory, 'release.json');
  let result;
  try {
    await writeFile(payloadPath, payload);
    result =
      await $`${ghCommand} api repos/${repository}/releases -X POST --input ${payloadPath}`.run(
        { capture: true }
      );
  } finally {
    await rm(payloadDirectory, { recursive: true, force: true });
  }

  // A release job re-run after a partial success (check-release-needed.mjs)
  // may find the release already there: GitHub answers HTTP 422
  // already_exists, which is the state this step exists to reach.
  if (
    result.code !== 0 &&
    /already_exists/.test(`${result.stdout || ''}${result.stderr || ''}`)
  ) {
    console.log(`::notice::GitHub release ${tag} already exists`);
    process.exit(0);
  }
  ensureCommandSucceeded(result, `create GitHub release ${tag}`);

  console.log(`\u2705 Created GitHub release: ${tag}`);
} catch (error) {
  console.error('Error creating release:', error.message);
  process.exit(1);
}

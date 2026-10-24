#!/usr/bin/env bun

/**
 * Script to format GitHub release notes:
 * - Publish the changes as Changesets wrote them (see
 *   format-release-notes-helpers.mjs for why nothing is "cleaned")
 * - Add links to the PRs that contain the changeset commits (if found)
 * - Add shields.io NPM version badge
 *
 * PR Detection Logic:
 * 1. Extract the commit hash of every changelog entry (if present)
 * 2. Fall back to --commit-sha argument (passed from workflow)
 * 3. Look up PRs that contain each commit via GitHub API
 * 4. If no PR found, simply don't display any PR link (no guessing)
 *
 * Uses link-foundation libraries:
 * - command-stream: Modern shell command execution with streaming support
 * - lino-arguments: Unified configuration from CLI args, env vars, and .lenv files
 *
 * Note: Uses --release-version instead of --version to avoid conflict with yargs' built-in --version flag.
 */

import { $ } from 'command-stream';
import { makeConfig } from 'lino-arguments';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { URL } from 'node:url';
import { ensureCommandSucceeded } from '../src/common.js';
import {
  buildNpmVersionBadge,
  buildReleaseDescription,
  formatRelatedPullRequests,
} from './format-release-notes-helpers.mjs';

const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8')
);
const packageNames = [packageJson.name, ...(packageJson.publishAliases || [])];

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
        describe: 'Version number (e.g., v0.8.36)',
      })
      .option('release-id', {
        type: 'string',
        default: getenv('RELEASE_ID', ''),
        describe: 'GitHub release ID',
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
      })
      .option('gh-command', {
        type: 'string',
        default: getenv('GH_COMMAND', 'gh'),
        describe: 'GitHub CLI executable',
      }),
});

const releaseId = config.releaseId;
const version = config.releaseVersion;
const repository = config.repository;
const passedCommitSha = config.commitSha;
const ghCommand = config.ghCommand;

if (!releaseId || !version || !repository) {
  console.error(
    'Usage: format-release-notes.mjs --release-id <releaseId> --release-version <version> --repository <repository> [--commit-sha <sha>]'
  );
  process.exit(1);
}

try {
  // Get current release body
  const result =
    await $`${ghCommand} api repos/${repository}/releases/${releaseId}`.run({
      capture: true,
    });
  ensureCommandSucceeded(result, `read GitHub release ${releaseId}`);
  const releaseData = JSON.parse(result.stdout);

  const currentBody = releaseData.body || '';

  // Skip if already formatted (has shields.io badge image)
  if (currentBody.includes('img.shields.io')) {
    console.log('ℹ️ Release notes already formatted');
    process.exit(0);
  }

  const release = buildReleaseDescription(currentBody);
  if (!release) {
    console.log('⚠️ Could not parse changes from release notes');
    console.log('   Looking for pattern: ### [Major|Minor|Patch] Changes');
    process.exit(0);
  }

  // Look up the PR of every changeset entry; entries without a hash fall
  // back to the commit that triggered the workflow.
  const commitShas =
    release.commitHashes.length > 0
      ? release.commitHashes
      : [passedCommitSha].filter(Boolean);
  if (commitShas.length === 0) {
    console.log('ℹ️ No commit SHA available - not adding PR link');
  }

  const prNumbers = [];
  for (const commitSha of commitShas) {
    const source = release.commitHashes.length > 0 ? 'changelog' : 'workflow';
    console.log(`ℹ️ Looking up PR for commit ${commitSha} (from ${source})`);

    try {
      const prResult =
        await $`${ghCommand} api "repos/${repository}/commits/${commitSha}/pulls"`.run(
          { capture: true }
        );
      ensureCommandSucceeded(
        prResult,
        `find pull requests for commit ${commitSha}`
      );
      const prsData = JSON.parse(prResult.stdout);

      // Find the PR that's not the version bump PR (not "chore: version packages")
      const relevantPr = prsData.find(
        (pr) => !pr.title.includes('version packages')
      );

      if (relevantPr) {
        console.log(`✅ Found PR #${relevantPr.number} containing commit`);
        if (!prNumbers.includes(relevantPr.number)) {
          prNumbers.push(relevantPr.number);
        }
      } else if (prsData.length > 0) {
        console.log(
          '⚠️ Found PRs but all are version bump PRs, not linking any'
        );
      } else {
        console.log(
          'ℹ️ No PR found containing this commit - not adding PR link'
        );
      }
    } catch (error) {
      console.log('⚠️ Could not find PR for commit', commitSha);
      console.log('   Error:', error.message);
      if (process.env.DEBUG) {
        console.error(error);
      }
    }
  }

  // Build formatted release notes
  const versionWithoutV = version.replace(/^v/, '');
  const npmBadge = packageNames
    .map((name) => buildNpmVersionBadge(name, version))
    .join(' ');

  let formattedBody = release.description;

  const relatedPullRequests = formatRelatedPullRequests(prNumbers);
  if (relatedPullRequests) {
    formattedBody += `\n\n${relatedPullRequests}`;
  }

  formattedBody += `\n\n---\n\n${npmBadge}`;

  // Update the release using JSON input to properly handle special characters
  const updatePayload = JSON.stringify({ body: formattedBody });
  const payloadDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'gh-upload-log-release-')
  );
  const payloadPath = path.join(payloadDirectory, 'release.json');

  try {
    await writeFile(payloadPath, updatePayload);
    const updateResult =
      await $`${ghCommand} api repos/${repository}/releases/${releaseId} -X PATCH --input "${payloadPath}"`.run(
        { capture: true }
      );
    ensureCommandSucceeded(updateResult, `update GitHub release ${releaseId}`);
  } finally {
    await rm(payloadDirectory, { recursive: true, force: true });
  }

  console.log(`✅ Formatted release notes for v${versionWithoutV}`);
  if (relatedPullRequests) {
    console.log(`   - Added ${relatedPullRequests}`);
  }
  console.log('   - Added shields.io npm badge');
} catch (error) {
  console.error('❌ Error formatting release notes:', error.message);
  process.exit(1);
}

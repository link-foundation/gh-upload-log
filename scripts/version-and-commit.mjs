#!/usr/bin/env bun

/**
 * Version packages and commit to main
 * Usage: node scripts/version-and-commit.mjs --mode <changeset|instant> [--bump-type <type>] [--description <desc>]
 *   changeset: Run changeset version
 *   instant: Run instant version bump with bump_type (patch|minor|major) and optional description
 *
 * Uses link-foundation libraries:
 * - command-stream: Modern shell command execution with streaming support
 * - lino-arguments: Unified configuration from CLI args, env vars, and .lenv files
 */

import { readFileSync, appendFileSync, readdirSync } from 'fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { $ } from 'command-stream';
import { makeConfig } from 'lino-arguments';
import { ensureCommandSucceeded } from '../src/common.js';
import {
  isBlockedByRepositoryRule,
  isNonFastForward,
} from './push-failure-classifier.mjs';

const PUSH_ATTEMPTS = 3;

/**
 * Append to GitHub Actions output file
 * @param {string} key
 * @param {string} value
 */
function appendOutput(key, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${key}=${value}\n`);
  }
}

/**
 * Count changeset files (excluding README.md)
 */
function countChangesets() {
  try {
    const changesetDir = '.changeset';
    const files = readdirSync(changesetDir);
    return files.filter((f) => f.endsWith('.md') && f !== 'README.md').length;
  } catch {
    return 0;
  }
}

function readLocalVersion() {
  return JSON.parse(readFileSync('./package.json', 'utf8')).version;
}

/**
 * Push the version commit to main. The main-writer concurrency group orders
 * writers but does not rebase them, so a commit merged meanwhile rejects the
 * push as non-fast-forward: rebase and retry. A repository rule (GH006,
 * GH013) can never be satisfied by a rebase, so fail with the rule's output.
 */
export async function pushToMain({
  run,
  logger = console,
  attempts = PUSH_ATTEMPTS,
}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await run`git push origin main`;
    if (result.code === 0) {
      return { attempt };
    }
    if (isBlockedByRepositoryRule(result)) {
      const output = (result.stderr || result.stdout || '').trim();
      throw new Error(
        `Failed to push version commit to main: a repository rule refused it, and no rebase can fix that. Remove the rule or add github-actions as a bypass actor (CI-CD-BEST-PRACTICES principle 9).\n${output}`
      );
    }
    if (!isNonFastForward(result) || attempt === attempts) {
      ensureCommandSucceeded(result, 'push version commit to main');
    }
    logger.log(
      `::warning::main advanced during the release (push attempt ${attempt} of ${attempts}); rebasing on origin/main before retrying.`
    );
    ensureCommandSucceeded(
      await run`git pull --rebase origin main`,
      'rebase the version commit on origin/main'
    );
  }
}

/**
 * Bump the version, commit it and push it to main.
 *
 * Every git/npm command is checked: command-stream resolves (does not throw)
 * when a command exits non-zero, so an unchecked `git push` used to report
 * version_committed=true and let the release job publish a version that
 * never reached main.
 */
export async function versionAndCommit({
  mode,
  bumpType,
  description,
  $: run = $,
  setOutput = appendOutput,
  readVersion = readLocalVersion,
  changesetCount = countChangesets,
  logger = console,
}) {
  const exec = async (command, operation) =>
    ensureCommandSucceeded(await command, operation);

  // Configure git
  await exec(
    run`git config user.name "github-actions[bot]"`,
    'configure git user.name'
  );
  await exec(
    run`git config user.email "github-actions[bot]@users.noreply.github.com"`,
    'configure git user.email'
  );

  // Check if remote main has advanced (handles re-runs after partial success)
  logger.log('Checking for remote changes...');
  await exec(run`git fetch origin main`, 'fetch origin main');

  const localHead = (
    await exec(run`git rev-parse HEAD`.run({ capture: true }), 'resolve HEAD')
  ).stdout.trim();
  const remoteHead = (
    await exec(
      run`git rev-parse origin/main`.run({ capture: true }),
      'resolve origin/main'
    )
  ).stdout.trim();

  if (localHead !== remoteHead) {
    logger.log(
      `Remote main has advanced (local: ${localHead}, remote: ${remoteHead})`
    );
    logger.log('This may indicate a previous attempt partially succeeded.');

    // Check if the remote version is already the expected bump
    const remotePackage = await exec(
      run`git show origin/main:package.json`.run({ capture: true }),
      'read package.json from origin/main'
    );
    const remoteVersion = JSON.parse(remotePackage.stdout).version;
    logger.log(`Remote version: ${remoteVersion}`);

    if (remoteVersion !== readVersion()) {
      // Reconcile while the checkout is still clean, before any changeset
      // merger can modify it. Read package files from the recovered commit.
      await exec(
        run`git checkout -B main origin/main`,
        'check out the committed version'
      );
      setOutput('version_committed', 'false');
      setOutput('already_released', 'true');
      setOutput('new_version', remoteVersion);
      return;
    }
    logger.log('Rebasing on remote main to incorporate changes...');
    await exec(run`git rebase origin/main`, 'rebase on origin/main');
  }

  // Get current version before bump
  const oldVersion = readVersion();
  logger.log(`Current version: ${oldVersion}`);

  if (mode === 'instant') {
    logger.log('Running instant version bump...');
    // Rely on command-stream's auto-quoting for proper argument handling
    if (description) {
      await exec(
        run`node scripts/instant-version-bump.mjs --bump-type ${bumpType} --description ${description}`,
        'run instant version bump'
      );
    } else {
      await exec(
        run`node scripts/instant-version-bump.mjs --bump-type ${bumpType}`,
        'run instant version bump'
      );
    }
  } else {
    if (changesetCount() > 1) {
      await exec(run`node scripts/merge-changesets.mjs`, 'merge changesets');
    }
    logger.log('Running changeset version...');
    // Run changeset version to bump versions and update CHANGELOG
    await exec(run`npm run changeset:version`, 'run changeset version');
  }

  // Get new version after bump
  const newVersion = readVersion();
  logger.log(`New version: ${newVersion}`);
  setOutput('new_version', newVersion);

  // Check if there are changes to commit
  const status = (
    await exec(
      run`git status --porcelain`.run({ capture: true }),
      'read git status'
    )
  ).stdout.trim();

  if (!status) {
    logger.log('No changes to commit');
    setOutput('version_committed', 'false');
    return;
  }

  logger.log('Changes detected, committing...');
  // Stage all changes (package.json, package-lock.json, CHANGELOG.md, deleted changesets)
  await exec(run`git add -A`, 'stage version changes');
  // Commit with version number as message (command-stream quotes it)
  await exec(run`git commit -m ${newVersion}`, 'commit version bump');
  // Push directly to main
  await pushToMain({ run, logger });

  logger.log('\u2705 Version bump committed and pushed to main');
  setOutput('version_committed', 'true');
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  // Parse CLI arguments using lino-arguments
  const config = makeConfig({
    yargs: ({ yargs, getenv }) =>
      yargs
        .option('mode', {
          type: 'string',
          default: getenv('MODE', 'changeset'),
          describe: 'Version mode: changeset or instant',
          choices: ['changeset', 'instant'],
        })
        .option('bump-type', {
          type: 'string',
          default: getenv('BUMP_TYPE', ''),
          describe:
            'Version bump type for instant mode: major, minor, or patch',
        })
        .option('description', {
          type: 'string',
          default: getenv('DESCRIPTION', ''),
          describe: 'Description for instant version bump',
        }),
  });

  const { mode, bumpType, description } = config;

  // Debug: Log parsed configuration
  console.log('Parsed configuration:', {
    mode,
    bumpType,
    description: description || '(none)',
  });

  // Detect if positional arguments were used (common mistake)
  const args = process.argv.slice(2);
  if (args.length > 0 && !args[0].startsWith('--')) {
    console.error('Error: Positional arguments detected!');
    console.error('Command line arguments:', args);
    console.error('');
    console.error(
      'This script requires named arguments (--mode, --bump-type, --description).'
    );
    console.error('Usage:');
    console.error('  Changeset mode:');
    console.error('    node scripts/version-and-commit.mjs --mode changeset');
    console.error('  Instant mode:');
    console.error(
      '    node scripts/version-and-commit.mjs --mode instant --bump-type <major|minor|patch> [--description <desc>]'
    );
    console.error('');
    console.error('Examples:');
    console.error(
      '  node scripts/version-and-commit.mjs --mode instant --bump-type patch --description "Fix bug"'
    );
    console.error('  node scripts/version-and-commit.mjs --mode changeset');
    process.exit(1);
  }

  // Validation: Ensure mode is set correctly
  if (mode !== 'changeset' && mode !== 'instant') {
    console.error(
      `Invalid mode: "${mode}". Expected "changeset" or "instant".`
    );
    console.error('Command line arguments:', process.argv.slice(2));
    process.exit(1);
  }

  // Validation: Ensure bump type is provided for instant mode
  if (mode === 'instant' && !bumpType) {
    console.error('Error: --bump-type is required for instant mode');
    console.error(
      'Usage: node scripts/version-and-commit.mjs --mode instant --bump-type <major|minor|patch> [--description <desc>]'
    );
    process.exit(1);
  }

  try {
    await versionAndCommit({ mode, bumpType, description });
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

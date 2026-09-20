#!/usr/bin/env bun

/**
 * Publish to npm using OIDC trusted publishing
 * Usage: node scripts/publish-to-npm.mjs [--should-pull]
 *   should_pull: Optional flag to pull latest changes before publishing (for release job)
 *
 * IMPORTANT: Update the PACKAGE_NAME constant below to match your package.json
 *
 * Uses command-stream for command execution and lino-arguments for configuration.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { $ } from 'command-stream';
import { makeConfig } from 'lino-arguments';
import { ensureCommandSucceeded } from '../src/common.js';

// TODO: Update this to match your package name in package.json
const PACKAGE_NAME = 'gh-upload-log';

const MAX_RETRIES = 3;
const RETRY_DELAY = 10000; // 10 seconds

/**
 * Sleep for specified milliseconds
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

/**
 * Publish a package, retrying command failures and rejecting after exhaustion.
 *
 * command-stream reports a failed command as a result with a non-zero `code`;
 * awaiting the command does not throw. Every result must therefore be checked
 * explicitly before the workflow can claim that publication succeeded.
 *
 * @param {Function} runPublish - Function that starts one publish attempt
 * @param {Object} [options={}] - Retry options
 * @param {number} [options.maxRetries=3] - Maximum publish attempts
 * @param {number} [options.retryDelay=10000] - Delay between attempts in ms
 * @param {Function} [options.sleepFn] - Injectable delay function for tests
 * @param {Object} [options.logger=console] - Logger with a log method
 * @returns {Promise<Object>} Successful command result
 */
export async function publishWithRetries(runPublish, options = {}) {
  const {
    maxRetries = MAX_RETRIES,
    retryDelay = RETRY_DELAY,
    sleepFn = sleep,
    logger = console,
  } = options;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    logger.log(`Publish attempt ${attempt} of ${maxRetries}...`);

    try {
      const result = await runPublish();
      return ensureCommandSucceeded(result, 'publish package to npm');
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries) {
        logger.log(
          `Publish failed, waiting ${retryDelay / 1000}s before retry...`
        );
        await sleepFn(retryDelay);
      }
    }
  }

  throw new Error(
    `Failed to publish after ${maxRetries} attempts: ${lastError?.message || 'unknown error'}`,
    { cause: lastError }
  );
}

/**
 * Append to GitHub Actions output file
 * @param {string} key
 * @param {string} value
 */
function setOutput(key, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${key}=${value}\n`);
  }
}

async function main() {
  const config = makeConfig({
    yargs: ({ yargs, getenv }) =>
      yargs.option('should-pull', {
        type: 'boolean',
        default: getenv('SHOULD_PULL', false),
        describe: 'Pull latest changes before publishing',
      }),
  });

  if (config.shouldPull) {
    // Pull the latest changes we just pushed
    const pullResult = await $`git pull origin main`;
    ensureCommandSucceeded(pullResult, 'pull the version commit from main');
  }

  // Get current version
  const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));
  const currentVersion = packageJson.version;
  console.log(`Current version to publish: ${currentVersion}`);

  // Check if this version is already published on npm
  console.log(`Checking if version ${currentVersion} is already published...`);
  const checkResult =
    await $`npm view "${PACKAGE_NAME}@${currentVersion}" version`.run({
      capture: true,
    });

  // command-stream returns { code: 0 } on success, { code: 1 } on failure (e.g., E404)
  // Exit code 0 means version exists, non-zero means version not found
  if (checkResult.code === 0) {
    console.log(`Version ${currentVersion} is already published to npm`);
    setOutput('published', 'true');
    setOutput('published_version', currentVersion);
    setOutput('already_published', 'true');
    return;
  }

  // Version not found on npm (E404), proceed with publish
  console.log(
    `Version ${currentVersion} not found on npm, proceeding with publish...`
  );

  await publishWithRetries(() => $`npm run changeset:publish`);

  // These outputs gate GitHub release creation, so only set them after a
  // verified zero exit code from the npm publication command.
  setOutput('published', 'true');
  setOutput('published_version', currentVersion);
  console.log(`\u2705 Published ${PACKAGE_NAME}@${currentVersion} to npm`);
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  });
}

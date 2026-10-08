#!/usr/bin/env bun

/**
 * Publish to npm using OIDC trusted publishing
 * Usage: node scripts/publish-to-npm.mjs [--should-pull]
 *   should_pull: Optional flag to pull latest changes before publishing (for release job)
 *
 * Uses command-stream for command execution and lino-arguments for configuration.
 */

import fs, { appendFileSync } from 'node:fs';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { $ } from 'command-stream';
import { makeConfig } from 'lino-arguments';
import { ensureCommandSucceeded } from '../src/common.js';

import { preparePackages } from './prepare-npm-packages.mjs';
export { preparePackages } from './prepare-npm-packages.mjs';

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

/** Check exact versions without npm/CDN metadata caches. Only a 404 means absent. */
export async function isVersionPublished(
  name,
  version,
  { fetchFn = fetch } = {}
) {
  const response = await fetchFn(
    `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}?check=${randomUUID()}`,
    {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      signal: globalThis.AbortSignal.timeout(30_000),
    }
  );
  if (response.status === 404) {
    await response.body?.cancel();
    return false;
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `npm registry check for ${name}@${version} failed (HTTP ${response.status})`
    );
  }
  const metadata = await response.json();
  if (metadata.name !== name || metadata.version !== version) {
    throw new Error(`Unexpected npm registry metadata for ${name}@${version}`);
  }
  return true;
}

/**
 * Resume partial publication and gate release outputs on every name. Each
 * successful publish gets a bounded five-minute registry visibility window.
 */
export async function publishPackages({
  packages,
  isPublished = isVersionPublished,
  runPublish = (pkg) => $`npm publish ${pkg.directory} --access public`,
  setOutput: output = setOutput,
  logger = console,
  sleepFn = sleep,
  verificationAttempts = 31,
  verificationDelayMs = 10_000,
  maxRetries = MAX_RETRIES,
  retryDelay = RETRY_DELAY,
}) {
  if (
    !packages?.length ||
    new Set(packages.map((pkg) => pkg.version)).size !== 1
  ) {
    throw new Error('Publication requires packages with the same version');
  }
  let alreadyPublished = true;
  for (const pkg of packages) {
    if (await isPublished(pkg.name, pkg.version)) {
      logger.log(`${pkg.name}@${pkg.version} is already published`);
      continue;
    }
    alreadyPublished = false;
    logger.log(`Publishing ${pkg.name}@${pkg.version}...`);
    await publishWithRetries(
      async () => {
        // A failed acknowledgement may have still published. Check before every
        // retry and immediately after failures to avoid immutable-version errors.
        if (await isPublished(pkg.name, pkg.version)) {
          return { code: 0 };
        }
        const result = await runPublish(pkg);
        if (result.code !== 0 && (await isPublished(pkg.name, pkg.version))) {
          return { code: 0 };
        }
        return result;
      },
      { logger, sleepFn, maxRetries, retryDelay }
    );
    let visible = false;
    for (let attempt = 0; attempt < verificationAttempts; attempt++) {
      if (await isPublished(pkg.name, pkg.version)) {
        visible = true;
        break;
      }
      if (attempt + 1 < verificationAttempts) {
        await sleepFn(verificationDelayMs);
      }
    }
    if (!visible) {
      throw new Error(
        `${pkg.name}@${pkg.version} is not visible on npm after publication; release outputs were not set`
      );
    }
    logger.log(`✅ Verified ${pkg.name}@${pkg.version} on npm`);
  }
  output('published', 'true');
  output('published_version', packages[0].version);
  output('already_published', String(alreadyPublished));
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
    ensureCommandSucceeded(
      await $`git pull origin main`,
      'pull the version commit from main'
    );
  }
  const outputDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'gh-upload-publish-')
  );
  try {
    await publishPackages({ packages: preparePackages({ outputDir }) });
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
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

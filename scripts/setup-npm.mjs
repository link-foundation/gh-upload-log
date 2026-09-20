#!/usr/bin/env bun

/**
 * Update npm for OIDC trusted publishing
 * npm trusted publishing requires npm >= 11.5.1
 * The release workflow uses Node.js 24.x and installs a compatible npm 11.x.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { $ } from 'command-stream';
import { ensureCommandSucceeded } from '../src/common.js';

export const TRUSTED_PUBLISHING_NPM_RANGE = '^11.5.1';

export async function setupNpm(commandStream = $) {
  // Get current npm version
  const currentResult = await commandStream`npm --version`.run({
    capture: true,
  });
  ensureCommandSucceeded(currentResult, 'read the current npm version');
  const currentVersion = currentResult.stdout.trim();
  console.log(`Current npm version: ${currentVersion}`);

  // npm 11.5.1 introduced OIDC publishing. Stay on npm 11 so future npm major
  // releases cannot unexpectedly require a newer Node runtime.
  const npmPackage = `npm@${TRUSTED_PUBLISHING_NPM_RANGE}`;
  const installResult = await commandStream`npm install -g ${npmPackage}`;
  ensureCommandSucceeded(installResult, `install ${npmPackage}`);

  // Get updated npm version
  const updatedResult = await commandStream`npm --version`.run({
    capture: true,
  });
  ensureCommandSucceeded(updatedResult, 'read the updated npm version');
  const updatedVersion = updatedResult.stdout.trim();
  console.log(`Updated npm version: ${updatedVersion}`);
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  setupNpm().catch((error) => {
    console.error('Error updating npm:', error.message);
    process.exit(1);
  });
}

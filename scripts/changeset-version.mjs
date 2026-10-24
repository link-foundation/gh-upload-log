#!/usr/bin/env bun

/**
 * Custom changeset version script that ensures package-lock.json is synchronized
 * with package.json after version bumps.
 *
 * This script:
 * 1. Runs `changeset version` to update package versions
 * 2. Runs `npm install` to synchronize package-lock.json with the new versions
 *
 * Uses link-foundation libraries:
 * - command-stream: Modern shell command execution with streaming support
 */

import { $ } from 'command-stream';
import { ensureCommandSucceeded } from '../src/common.js';

try {
  console.log('Running changeset version...');
  ensureCommandSucceeded(
    await $`npx changeset version`,
    'run changeset version'
  );

  console.log('\nSynchronizing package-lock.json...');
  ensureCommandSucceeded(
    await $`npm install --package-lock-only`,
    'synchronize package-lock.json'
  );

  console.log('\n✅ Version bump complete with synchronized package-lock.json');
} catch (error) {
  console.error('Error during version bump:', error.message);
  if (process.env.DEBUG) {
    console.error('Stack trace:', error.stack);
  }
  process.exit(1);
}

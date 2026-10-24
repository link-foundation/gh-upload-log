#!/usr/bin/env bun

/**
 * Fail a pull request that edits package.json "version" by hand
 * (hive-mind CI/CD principle #9). Versions are bumped only by the release
 * job from changesets, so a manual bump would desynchronise npm, the
 * changelog and the GitHub release.
 *
 * Environment: GITHUB_BASE_SHA (required in CI), GITHUB_HEAD_REF.
 * Verbose: CHECK_VERSION_VERBOSE=1 prints both versions.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Return an error message when the version changed, otherwise null. */
export function checkVersionChange({ baseVersion, headVersion, headRef = '' }) {
  if (headRef.startsWith('changeset-release/')) {
    return null;
  }
  if (baseVersion === headVersion) {
    return null;
  }
  return `package.json version changed from ${baseVersion} to ${headVersion}. Versions are bumped only by the release workflow; revert the version field and add a changeset (bun run changeset) instead.`;
}

function versionAt(ref) {
  return JSON.parse(
    execFileSync('git', ['show', `${ref}:package.json`], { encoding: 'utf8' })
  ).version;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const baseSha = process.env.GITHUB_BASE_SHA;
  if (!baseSha) {
    console.log('::error::GITHUB_BASE_SHA is required to compare versions');
    process.exit(1);
  }
  const baseVersion = versionAt(baseSha);
  const headVersion = JSON.parse(readFileSync('package.json', 'utf8')).version;
  if (process.env.CHECK_VERSION_VERBOSE === '1') {
    console.log(`base ${baseSha}: ${baseVersion}; head: ${headVersion}`);
  }
  const error = checkVersionChange({
    baseVersion,
    headVersion,
    headRef: process.env.GITHUB_HEAD_REF,
  });
  if (error) {
    console.log(
      `::error file=package.json,title=Manual version change::${error}`
    );
    process.exit(1);
  }
  console.log(`package.json version unchanged (${headVersion}).`);
}

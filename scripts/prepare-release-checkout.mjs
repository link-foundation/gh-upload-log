#!/usr/bin/env node

/**
 * Reconcile an untouched workflow checkout BEFORE dependency installation,
 * changeset inspection or versioning. A rerun retains GITHUB_SHA from its
 * original attempt: the first subsequent version commit is its recovery
 * target, even if main now contains new changesets or another version.
 * No npm/GitHub artifact is mutated here. RELEASE_RECOVERY_VERBOSE=1 logs
 * every Git command and selected commit/version.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function gitOutput(args, { cwd = process.cwd(), verbose = false } = {}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (verbose) {
    console.log(
      `$ git ${args.join(' ')}\n${result.stdout || ''}${result.stderr || ''}`
    );
  }
  if (result.error || result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed: ${result.error?.message || ''}\n${result.stderr || result.stdout || ''}`
    );
  }
  return (result.stdout || '').trim();
}

function appendOutput(key, value) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
}

// Keep the current recovery implementation when the artifact source predates
// it. Switching to an old version must not restore its broken smoke tester.
export function snapshotReleaseTools() {
  const source = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..'
  );
  const directory = mkdtempSync(path.join(tmpdir(), 'gh-release-tools-'));
  for (const file of ['scripts', 'src', 'package.json', 'bun.lock']) {
    cpSync(path.join(source, file), path.join(directory, file), {
      recursive: true,
    });
  }
  return directory;
}

export function prepareReleaseCheckout({
  cwd = process.cwd(),
  sourceSha = process.env.RELEASE_SOURCE_SHA ||
    process.env.GITHUB_SHA ||
    'HEAD',
  recoveryOnly = process.env.RECOVERY_ONLY === 'true',
  preserveTools = false,
  setOutput = appendOutput,
  verbose = process.env.RELEASE_RECOVERY_VERBOSE === '1',
  logger = console,
} = {}) {
  const git = (args) => gitOutput(args, { cwd, verbose });
  if (recoveryOnly && !/^[a-f0-9]{40,64}$/i.test(sourceSha)) {
    throw new Error(
      'Recovery requires recovery_sha: the full original workflow commit SHA.'
    );
  }
  if (git(['status', '--porcelain'])) {
    throw new Error(
      'Release checkout must be clean before reconciliation; run preparation before merging or consuming changesets.'
    );
  }
  const source = git(['rev-parse', '--verify', `${sourceSha}^{commit}`]);
  git(['fetch', 'origin', 'main']);
  git(['merge-base', '--is-ancestor', source, 'origin/main']);
  const versionAt = (commit) =>
    JSON.parse(git(['show', `${commit}:package.json`])).version;
  const sourceVersion = versionAt(source);
  let target = git(['rev-parse', 'origin/main']);
  let recoveredVersion = '';
  const candidates = git([
    'rev-list',
    '--first-parent',
    '--reverse',
    `${source}..origin/main`,
    '--',
    'package.json',
  ])
    .split('\n')
    .filter(Boolean);
  for (const commit of candidates) {
    const version = versionAt(commit);
    if (version !== sourceVersion) {
      target = commit;
      recoveredVersion = version;
      break;
    }
  }
  if (recoveryOnly && !recoveredVersion) {
    throw new Error(
      `No version commit found after ${source}; recovery cannot create a new version.`
    );
  }
  const toolsDirectory = preserveTools ? snapshotReleaseTools() : undefined;
  // The Actions checkout may be detached. Create the local main branch at
  // the selected commit so version pushes work, without rewriting remote main.
  git(['checkout', '-B', 'main', target]);
  logger.log(
    recoveredVersion
      ? `::notice::Resuming ${recoveredVersion} at ${target} from original workflow ${source}; skipping version bump.`
      : `Release checkout reconciled with origin/main at ${target}`
  );
  setOutput('recovered_version', recoveredVersion);
  setOutput('release_commit', target);
  if (toolsDirectory) {
    setOutput('tools_dir', toolsDirectory);
  }
  return {
    recoveredVersion,
    releaseCommit: target,
    version: versionAt(target),
    toolsDirectory,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { toolsDirectory } = prepareReleaseCheckout({ preserveTools: true });
    if (process.env.GITHUB_ENV) {
      appendFileSync(
        process.env.GITHUB_ENV,
        `RELEASE_TOOLS=${toolsDirectory}\n`
      );
    }
  } catch (error) {
    console.error(
      `::error title=Release checkout reconciliation failed::${error.message}`
    );
    process.exitCode = 1;
  }
}

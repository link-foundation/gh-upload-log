#!/usr/bin/env node

// actions/dependency-review-action fails with "Dependency review is not
// supported on this repository" when the repository's dependency graph is
// disabled (run 40078460897). Enabling it is a repository setting only an
// admin can change, so this check turns that state into an explicit
// annotation instead of an opaque action failure.
//
// Usage: node scripts/check-dependency-graph.mjs [--mode enforce|report]
//
// Environment:
//   GITHUB_REPOSITORY          owner/repo to check (set by GitHub Actions).
//   GITHUB_TOKEN               token with contents: read.
//   GITHUB_OUTPUT              receives enabled=true|false for later steps.
//   DEPENDENCY_GRAPH_MODE      enforce (default) fails when the graph is
//                              disabled; report warns and passes, so pull
//                              requests stay green while main names the fix.
//   DEPENDENCY_GRAPH_VERBOSE   1 logs the request and response status.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ANNOTATION_TITLE = 'Dependency graph disabled';

/**
 * Return true when the dependency graph is enabled. The SBOM endpoint answers
 * 404 exactly when the graph is off; any other failure is not evidence either
 * way, so it throws instead of guessing.
 */
export async function isDependencyGraphEnabled({
  repository,
  token,
  fetchFn = fetch,
  logger = { log() {} },
}) {
  const url = `https://api.github.com/repos/${repository}/dependency-graph/sbom`;
  logger.log(`GET ${url}`);
  const response = await fetchFn(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: globalThis.AbortSignal.timeout(30_000),
  });
  logger.log(`HTTP ${response.status}`);
  await response.body?.cancel();
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw new Error(
      `Dependency graph check for ${repository} failed (HTTP ${response.status})`
    );
  }
  return true;
}

export async function runDependencyGraphCheck({
  repository,
  token,
  mode = 'enforce',
  fetchFn = fetch,
  logger = console,
  verbose = false,
  setOutput = () => {},
}) {
  if (!['enforce', 'report'].includes(mode)) {
    logger.error(`::error::Unknown dependency graph check mode: ${mode}`);
    return 2;
  }
  if (!repository) {
    logger.error('::error::GITHUB_REPOSITORY is not set');
    return 2;
  }
  let enabled;
  try {
    enabled = await isDependencyGraphEnabled({
      repository,
      token,
      fetchFn,
      logger: verbose ? logger : undefined,
    });
  } catch (error) {
    logger.log(`::error title=${ANNOTATION_TITLE}::${error.message}`);
    return 1;
  }
  setOutput('enabled', String(enabled));
  if (enabled) {
    logger.log(`Dependency graph is enabled for ${repository}.`);
    return 0;
  }
  const message = `The dependency graph is disabled for ${repository}, so Dependency Review cannot run. A repository admin must enable it at https://github.com/${repository}/settings/security_analysis (Dependency graph: Enable).`;
  if (mode === 'enforce') {
    logger.log(`::error title=${ANNOTATION_TITLE}::${message}`);
    return 1;
  }
  logger.log(
    `::warning title=${ANNOTATION_TITLE}::${message} Dependency Review is skipped on this pull request; main fails until this is resolved.`
  );
  return 0;
}

function readMode(argv, env) {
  const index = argv.indexOf('--mode');
  if (index !== -1) {
    return argv[index + 1] ?? '';
  }
  const inline = argv.find((arg) => arg.startsWith('--mode='));
  return inline
    ? inline.slice('--mode='.length)
    : env.DEPENDENCY_GRAPH_MODE || 'enforce';
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const outputFile = process.env.GITHUB_OUTPUT;
  runDependencyGraphCheck({
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GITHUB_TOKEN,
    mode: readMode(process.argv.slice(2), process.env),
    verbose: process.env.DEPENDENCY_GRAPH_VERBOSE === '1',
    setOutput: (name, value) =>
      outputFile && fs.appendFileSync(outputFile, `${name}=${value}\n`),
  }).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.log(`::error title=${ANNOTATION_TITLE}::${error.message}`);
      process.exitCode = 1;
    }
  );
}

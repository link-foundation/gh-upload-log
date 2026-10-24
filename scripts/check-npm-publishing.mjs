#!/usr/bin/env bun

// Run before versioning so missing npm account setup cannot consume a changeset
// or push an unreleasable version commit. Account authorization stays on npm.
//
// Usage: bun scripts/check-npm-publishing.mjs [--mode release|report]
//
// Environment:
//   NPM_PREFLIGHT_MODE     release (default) fails the step when an npm owner
//                          has to act; report annotates with a warning and
//                          passes, so pull requests stay green while main
//                          names the blocker.
//   HAS_NPM_TOKEN          'true' when the NPM_TOKEN secret is configured; the
//                          publish step can then bootstrap missing packages.
//   NPM_PREFLIGHT_VERBOSE  1 logs every registry request and response status.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ANNOTATION_TITLE = 'npm owner action required';

export async function checkNpmPublishing({
  names,
  fetchFn = fetch,
  hasBootstrapToken = false,
  logger = { log() {} },
} = {}) {
  const missing = [];
  for (const name of names) {
    const url = `https://registry.npmjs.org/${encodeURIComponent(name)}?check=${randomUUID()}`;
    logger.log(`GET ${url}`);
    const response = await fetchFn(url, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      signal: globalThis.AbortSignal.timeout(30_000),
    });
    logger.log(`${name}: HTTP ${response.status}`);
    if (response.status === 404) {
      await response.body?.cancel();
      missing.push(name);
    } else if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `npm registry check for ${name} failed (HTTP ${response.status})`
      );
    } else if ((await response.json()).name !== name) {
      throw new Error(`Unexpected npm registry metadata for ${name}`);
    }
  }
  if (missing.length && !hasBootstrapToken) {
    throw new Error(
      `npm owner setup required for ${missing.join(', ')}: first publish each missing package with an authorized npm account (npm publish --access public, with 2FA), or add an NPM_TOKEN repository secret so the release job can bootstrap it, then configure its trusted publisher for link-foundation/gh-upload-log, workflow release.yml, allowing publication. Check gh-upload-log separately. See docs/npm-publishing.md. No version was bumped or published by this preflight.`
    );
  }
  return { missing };
}

/** Escape a value for a GitHub Actions workflow command. */
export function escapeAnnotation(text) {
  return String(text)
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');
}

/**
 * Turn the preflight result into the step's exit code and annotations.
 * Release mode fails with an ::error:: naming the owner action; report mode
 * (pull requests) shows the same message as a ::warning:: and passes.
 */
export async function runPreflight({
  names,
  mode = 'release',
  hasBootstrapToken = false,
  fetchFn = fetch,
  logger = console,
  verbose = false,
  writeSummary = () => {},
}) {
  if (!['release', 'report'].includes(mode)) {
    logger.error(`::error::Unknown npm preflight mode: ${mode}`);
    return 2;
  }
  try {
    const { missing } = await checkNpmPublishing({
      names,
      fetchFn,
      hasBootstrapToken,
      logger: verbose ? logger : undefined,
    });
    if (missing.length) {
      logger.log(
        `::notice title=npm bootstrap via NPM_TOKEN::${missing.join(', ')} not on npm yet; the publish step will create it with the NPM_TOKEN secret. Configure its trusted publisher afterwards and remove the token.`
      );
    } else {
      logger.log(
        'All npm package names exist; workflow authorization will be verified by npm publish.'
      );
    }
    return 0;
  } catch (error) {
    const level = mode === 'release' ? 'error' : 'warning';
    const suffix =
      mode === 'release'
        ? ''
        : ' (report mode: this pull request is not blocked; the release on main will fail until this is resolved)';
    logger.log(
      `::${level} title=${ANNOTATION_TITLE}::${escapeAnnotation(error.message + suffix)}`
    );
    writeSummary(`### ${ANNOTATION_TITLE}\n\n${error.message}${suffix}\n`);
    return mode === 'release' ? 1 : 0;
  }
}

function readMode(argv, env) {
  const index = argv.indexOf('--mode');
  if (index !== -1) {
    return argv[index + 1] ?? '';
  }
  const inline = argv.find((arg) => arg.startsWith('--mode='));
  return inline
    ? inline.slice('--mode='.length)
    : env.NPM_PREFLIGHT_MODE || 'release';
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  runPreflight({
    names: [pkg.name, ...(pkg.publishAliases || [])],
    mode: readMode(process.argv.slice(2), process.env),
    hasBootstrapToken: process.env.HAS_NPM_TOKEN === 'true',
    verbose: process.env.NPM_PREFLIGHT_VERBOSE === '1',
    writeSummary: (text) =>
      summaryFile && fs.appendFileSync(summaryFile, `${text}\n`),
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

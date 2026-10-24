#!/usr/bin/env bun

// Run before versioning so missing npm account setup cannot consume a changeset
// or push an unreleasable version commit. Account authorization stays on npm.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export async function checkNpmPublishing({ names, fetchFn = fetch } = {}) {
  const missing = [];
  for (const name of names) {
    const response = await fetchFn(
      `https://registry.npmjs.org/${encodeURIComponent(name)}?check=${randomUUID()}`,
      {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
        signal: globalThis.AbortSignal.timeout(30_000),
      }
    );
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
  if (missing.length) {
    throw new Error(
      `npm owner setup required for ${missing.join(', ')}: first publish each missing package with an authorized npm account (npm publish --access public, with 2FA), then configure its trusted publisher for link-foundation/gh-upload-log, workflow release.yml, allowing publication. Check gh-upload-log separately. See docs/npm-publishing.md. No version was bumped or published by this preflight.`
    );
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  checkNpmPublishing({ names: [pkg.name, ...(pkg.publishAliases || [])] }).then(
    () =>
      console.log(
        'All npm package names exist; workflow authorization will be verified by npm publish.'
      ),
    (error) => {
      console.error(`Error: ${error.message}`);
      process.exitCode = 1;
    }
  );
}

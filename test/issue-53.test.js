import fs from 'node:fs';
import { assert, test } from 'test-anywhere';
import { publishWithRetries } from '../scripts/publish-to-npm.mjs';

const read = (name) =>
  fs.readFileSync(new globalThis.URL(name, import.meta.url), 'utf8');

test('README npm badge targets an actually published package', () => {
  const readme = read('../README.md');
  const match = readme.match(
    /\[!\[.*?\]\(https:\/\/img\.shields\.io\/npm\/v\/([^/)]+)\.svg[^)]*\)\]\(https:\/\/www\.npmjs\.com\/package\/([^/)]+)\)/
  );
  assert.ok(match, 'README must contain a dynamic npm version badge');
  assert.equal(
    match[1],
    match[2],
    'Badge and link must describe the same package'
  );
  const metadata = JSON.parse(
    read(`../docs/case-studies/issue-53/data/registry-${match[1]}.json`)
  );
  assert.ok(
    metadata['dist-tags']?.latest,
    'Badge package must have a published latest version'
  );
});

test('failed npm publication explains package bootstrap and trust configuration', async () => {
  let error;
  try {
    await publishWithRetries(
      async () => ({
        code: 1,
        stderr:
          'npm error code E404\nNot Found - PUT https://registry.npmjs.org/gh-upload-file',
      }),
      {
        maxRetries: 1,
        logger: { log() {} },
      }
    );
  } catch (caught) {
    error = caught;
  }
  assert.ok(
    error?.message.includes('E404'),
    'Preserve original npm diagnostics'
  );
  assert.ok(
    error?.message.includes('release.yml'),
    'Explain the trusted publisher workflow'
  );
  assert.ok(
    error?.message.includes('first publish'),
    'Explain how to bootstrap a missing package'
  );
});

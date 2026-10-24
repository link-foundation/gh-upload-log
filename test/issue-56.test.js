import { test } from 'test-anywhere';
import assert from 'node:assert/strict';
import * as preflight from '../scripts/check-npm-publishing.mjs';

const packages = ['gh-upload-file', 'gh-upload-log'];

test('OIDC preflight blocks missing packages with exact owner recovery steps', async () => {
  const checked = [];
  await assert.rejects(
    preflight.checkNpmPublishing({
      names: packages,
      fetchFn: async (url) => {
        checked.push(url);
        return new globalThis.Response('{"error":"Not found"}', {
          status: 404,
        });
      },
    }),
    /gh-upload-file.*first publish.*release.yml/s
  );
  assert.equal(
    checked.length,
    2,
    'Check every package, including the compatibility name'
  );
});

test('OIDC preflight accepts existing packages but never treats registry outages as missing', async () => {
  await preflight.checkNpmPublishing({
    names: packages,
    fetchFn: async (url) =>
      globalThis.Response.json({
        name: decodeURIComponent(new globalThis.URL(url).pathname.slice(1)),
      }),
  });
  await assert.rejects(
    preflight.checkNpmPublishing({
      names: packages,
      fetchFn: async () => new globalThis.Response('', { status: 503 }),
    }),
    /HTTP 503/
  );
  await assert.rejects(
    preflight.checkNpmPublishing({
      names: packages,
      fetchFn: async () =>
        globalThis.Response.json({ name: 'another-package' }),
    }),
    /Unexpected npm registry metadata/
  );
});

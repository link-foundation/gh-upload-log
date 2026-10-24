import { test } from 'test-anywhere';
import assert from 'node:assert/strict';
import {
  checkNpmPublishing,
  runPreflight,
} from '../scripts/check-npm-publishing.mjs';

const names = ['gh-upload-file', 'gh-upload-log'];

function registry(missing) {
  return async (url) => {
    const name = decodeURIComponent(new globalThis.URL(url).pathname.slice(1));
    return missing.includes(name)
      ? new globalThis.Response('{"error":"Not found"}', { status: 404 })
      : globalThis.Response.json({ name });
  };
}

function capture() {
  const lines = [];
  const summary = [];
  return {
    lines,
    summary,
    logger: { log: (line) => lines.push(line), error: (l) => lines.push(l) },
    writeSummary: (text) => summary.push(text),
  };
}

test('release mode fails with an ::error:: annotation naming the owner action', async () => {
  const out = capture();
  const code = await runPreflight({
    names,
    mode: 'release',
    fetchFn: registry(['gh-upload-file']),
    logger: out.logger,
    writeSummary: out.writeSummary,
  });
  assert.equal(code, 1);
  const annotation = out.lines.find((line) => line.startsWith('::error '));
  assert.ok(annotation, `Expected an ::error:: line, got ${out.lines}`);
  assert.match(annotation, /title=npm owner action required::/);
  assert.match(annotation, /gh-upload-file.*docs\/npm-publishing\.md/);
  assert.match(out.summary.join(''), /npm owner action required/);
});

test('report mode warns about the same blocker without failing pull requests', async () => {
  const out = capture();
  const code = await runPreflight({
    names,
    mode: 'report',
    fetchFn: registry(['gh-upload-file']),
    logger: out.logger,
    writeSummary: out.writeSummary,
  });
  assert.equal(code, 0);
  assert.ok(out.lines.some((line) => line.startsWith('::warning ')));
  assert.ok(!out.lines.some((line) => line.startsWith('::error')));
});

test('an NPM_TOKEN secret lets the release bootstrap missing packages', async () => {
  const out = capture();
  const code = await runPreflight({
    names,
    mode: 'release',
    hasBootstrapToken: true,
    fetchFn: registry(['gh-upload-file']),
    logger: out.logger,
  });
  assert.equal(code, 0);
  assert.ok(out.lines.some((line) => /^::notice .*gh-upload-file/.test(line)));
  const { missing } = await checkNpmPublishing({
    names,
    hasBootstrapToken: true,
    fetchFn: registry(['gh-upload-file']),
  });
  assert.deepEqual(missing, ['gh-upload-file']);
});

test('registry outages fail release mode instead of passing silently', async () => {
  const out = capture();
  const code = await runPreflight({
    names,
    mode: 'release',
    hasBootstrapToken: true,
    fetchFn: async () => new globalThis.Response('', { status: 503 }),
    logger: out.logger,
  });
  assert.equal(code, 1);
  assert.ok(out.lines.some((line) => /^::error .*HTTP 503/.test(line)));
});

test('verbose mode traces every registry request; unknown modes are rejected', async () => {
  const out = capture();
  await runPreflight({
    names,
    mode: 'release',
    fetchFn: registry([]),
    logger: out.logger,
    verbose: true,
  });
  assert.equal(out.lines.filter((line) => line.startsWith('GET ')).length, 2);
  assert.equal(
    await runPreflight({ names, mode: 'bogus', logger: capture().logger }),
    2
  );
});

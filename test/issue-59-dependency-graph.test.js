import { test } from 'test-anywhere';
import assert from 'node:assert/strict';
import { runDependencyGraphCheck } from '../scripts/check-dependency-graph.mjs';

const repository = 'link-foundation/gh-upload-log';

// Each call answers with the next status; an Error entry is thrown instead.
function api(...statuses) {
  const requests = [];
  return {
    requests,
    fetchFn: async (url, options) => {
      requests.push({ url, options });
      const status = statuses[Math.min(requests.length, statuses.length) - 1];
      if (status instanceof Error) {
        throw status;
      }
      return new globalThis.Response('{}', { status });
    },
  };
}

const noSleep = async () => {};

function capture() {
  const lines = [];
  const outputs = {};
  return {
    lines,
    outputs,
    logger: { log: (line) => lines.push(line), error: (l) => lines.push(l) },
    setOutput: (name, value) => {
      outputs[name] = value;
    },
  };
}

test('a disabled dependency graph fails main with the settings link', async () => {
  const out = capture();
  const code = await runDependencyGraphCheck({
    repository,
    mode: 'enforce',
    fetchFn: api(404).fetchFn,
    logger: out.logger,
    setOutput: out.setOutput,
  });
  assert.equal(code, 1);
  assert.equal(out.outputs.enabled, 'false');
  const annotation = out.lines.find((line) => line.startsWith('::error '));
  assert.match(annotation, /title=Dependency graph disabled::/);
  assert.match(
    annotation,
    /github\.com\/link-foundation\/gh-upload-log\/settings\/security_analysis/
  );
});

test('a disabled dependency graph only warns on pull requests', async () => {
  const out = capture();
  const code = await runDependencyGraphCheck({
    repository,
    mode: 'report',
    fetchFn: api(404).fetchFn,
    logger: out.logger,
    setOutput: out.setOutput,
  });
  assert.equal(code, 0);
  assert.equal(out.outputs.enabled, 'false');
  assert.ok(out.lines.some((line) => line.startsWith('::warning ')));
  assert.ok(!out.lines.some((line) => line.startsWith('::error')));
});

test('an enabled dependency graph lets Dependency Review run', async () => {
  const out = capture();
  const { fetchFn, requests } = api(200);
  const code = await runDependencyGraphCheck({
    repository,
    token: 'secret-token',
    fetchFn,
    logger: out.logger,
    setOutput: out.setOutput,
  });
  assert.equal(code, 0);
  assert.equal(out.outputs.enabled, 'true');
  assert.equal(
    requests[0].url,
    'https://api.github.com/repos/link-foundation/gh-upload-log/dependency-graph/sbom'
  );
  assert.equal(
    requests[0].options.headers.Authorization,
    'Bearer secret-token'
  );
});

test('persistent API failures are errors in every mode, never a guess', async () => {
  for (const mode of ['enforce', 'report']) {
    const out = capture();
    const { fetchFn, requests } = api(403, 500, new Error('ECONNRESET'));
    const code = await runDependencyGraphCheck({
      repository,
      mode,
      fetchFn,
      sleep: noSleep,
      logger: out.logger,
      setOutput: out.setOutput,
    });
    assert.equal(code, 1);
    assert.equal(requests.length, 3);
    assert.equal(out.outputs.enabled, undefined);
    assert.match(out.lines.join('\n'), /::error .*unknown after 3 attempts/);
    assert.doesNotMatch(out.lines.join('\n'), /settings\/security_analysis/);
  }
});

test('rate limits and 5xx are retried before the graph state is decided', async () => {
  const out = capture();
  const { fetchFn, requests } = api(429, 502, 404);
  const code = await runDependencyGraphCheck({
    repository,
    mode: 'report',
    fetchFn,
    sleep: noSleep,
    logger: out.logger,
    setOutput: out.setOutput,
  });
  assert.equal(code, 0);
  assert.equal(requests.length, 3);
  assert.equal(out.outputs.enabled, 'false');
});

test('verbose mode is off by default and logs requests when enabled', async () => {
  const quiet = capture();
  await runDependencyGraphCheck({
    repository,
    fetchFn: api(200).fetchFn,
    logger: quiet.logger,
  });
  assert.ok(!quiet.lines.some((line) => line.startsWith('GET ')));

  const loud = capture();
  await runDependencyGraphCheck({
    repository,
    verbose: true,
    fetchFn: api(200).fetchFn,
    logger: loud.logger,
  });
  assert.ok(loud.lines.some((line) => line.startsWith('GET ')));
  assert.ok(loud.lines.includes('HTTP 200'));
});

test('unknown modes and a missing repository are usage errors', async () => {
  const out = capture();
  assert.equal(
    await runDependencyGraphCheck({
      repository,
      mode: 'x',
      logger: out.logger,
    }),
    2
  );
  assert.equal(await runDependencyGraphCheck({ logger: out.logger }), 2);
});

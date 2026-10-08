import { test } from 'test-anywhere';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { URL } from 'node:url';
import * as publishing from '../scripts/publish-to-npm.mjs';

const logger = { log() {} };

test('issue #37 - both package names ship the universal and legacy bins', () => {
  const pkg = JSON.parse(
    fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  );
  assert.equal(pkg.bin['gh-upload'], 'src/cli.js');
  assert.equal(pkg.bin['gh-upload-log'], 'src/cli.js');
  assert.deepEqual([pkg.name, ...pkg.publishAliases].sort(), [
    'gh-upload',
    'gh-upload-log',
  ]);
});

test('issue #37 - npm checks bypass caches and distinguish absence from registry failure', async () => {
  assert.equal(typeof publishing.isVersionPublished, 'function');
  const requests = [];
  const fetchFn = async (url, options) => {
    requests.push({ url, options });
    return { status: 404, ok: false };
  };
  assert.equal(
    await publishing.isVersionPublished('gh-upload', '1.2.3', { fetchFn }),
    false
  );
  assert.equal(
    await publishing.isVersionPublished('gh-upload', '1.2.3', { fetchFn }),
    false
  );
  assert.notEqual(requests[0].url, requests[1].url);
  assert.ok(
    requests.every(
      ({ url, options }) =>
        url.startsWith('https://registry.npmjs.org/gh-upload/1.2.3?') &&
        options.headers['Cache-Control'] === 'no-cache'
    )
  );
  await assert.rejects(
    publishing.isVersionPublished('gh-upload', '1.2.3', {
      fetchFn: async () => ({ status: 503, ok: false }),
    }),
    /503/
  );
});

test('issue #37 - a partial dual publication retries only the missing package and gates release outputs', async () => {
  assert.equal(typeof publishing.publishPackages, 'function');
  const published = [];
  const outputs = {};
  await publishing.publishPackages({
    packages: [
      { name: 'gh-upload-log', version: '1.2.3', directory: '/legacy' },
      { name: 'gh-upload', version: '1.2.3', directory: '/universal' },
    ],
    isPublished: async (name) =>
      name === 'gh-upload-log' || published.includes(name),
    runPublish: async (pkg) => {
      published.push(pkg.name);
      return { code: 0 };
    },
    setOutput: (key, value) => {
      outputs[key] = value;
    },
    logger,
    sleepFn: async () => {},
  });
  assert.deepEqual(published, ['gh-upload']);
  assert.equal(outputs.published, 'true');
  assert.equal(outputs.published_version, '1.2.3');
});

test('issue #37 - release success requires every package to become visible on npm', async () => {
  assert.equal(typeof publishing.publishPackages, 'function');
  const outputs = {};
  await assert.rejects(
    publishing.publishPackages({
      packages: [
        { name: 'gh-upload', version: '1.2.3', directory: '/universal' },
      ],
      isPublished: async () => false,
      runPublish: async () => ({ code: 0 }),
      setOutput: (key, value) => {
        outputs[key] = value;
      },
      verificationAttempts: 2,
      sleepFn: async () => {},
      logger,
    }),
    /not visible|not published/
  );
  assert.notEqual(outputs.published, 'true');
});

test('issue #37 - failed publish acknowledgement is recovered without republishing', async () => {
  assert.equal(typeof publishing.publishPackages, 'function');
  let published = false;
  let attempts = 0;
  await publishing.publishPackages({
    packages: [
      { name: 'gh-upload', version: '1.2.3', directory: '/universal' },
    ],
    isPublished: async () => published,
    runPublish: async () => {
      attempts++;
      published = true;
      return { code: 1, stderr: 'connection lost' };
    },
    sleepFn: async () => {},
    logger,
  });
  assert.equal(attempts, 1);
});

test('issue #37 - prepare manifests keeps source version and code identical for both names', async () => {
  assert.equal(typeof publishing.preparePackages, 'function');
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'issue-37-packages-')
  );
  try {
    const packages = await publishing.preparePackages({ outputDir: directory });
    assert.deepEqual(packages.map((pkg) => pkg.name).sort(), [
      'gh-upload',
      'gh-upload-log',
    ]);
    const manifests = packages.map((pkg) =>
      JSON.parse(
        fs.readFileSync(path.join(pkg.directory, 'package.json'), 'utf8')
      )
    );
    assert.equal(manifests[0].version, manifests[1].version);
    assert.deepEqual(manifests[0].bin, manifests[1].bin);
    assert.deepEqual(
      fs.readFileSync(path.join(packages[0].directory, 'src/index.js')),
      fs.readFileSync(path.join(packages[1].directory, 'src/index.js'))
    );
    assert.ok(manifests.every((manifest) => !manifest.scripts?.prepare));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('issue #37 - delayed registry visibility is polled before release outputs', async () => {
  let published = false;
  let checks = 0;
  let waits = 0;
  const outputs = {};
  await publishing.publishPackages({
    packages: [
      { name: 'gh-upload', version: '1.2.3', directory: '/universal' },
    ],
    isPublished: async () => published && ++checks >= 3,
    runPublish: async () => {
      published = true;
      return { code: 0 };
    },
    sleepFn: async () => {
      waits++;
      assert.equal(outputs.published, undefined);
    },
    setOutput: (key, value) => {
      outputs[key] = value;
    },
    logger,
  });
  assert.equal(waits, 2);
  assert.equal(outputs.published, 'true');
});

test('issue #37 - failure of the second name never reports a complete release', async () => {
  const visible = new Set();
  const outputs = {};
  await assert.rejects(
    publishing.publishPackages({
      packages: ['gh-upload', 'gh-upload-log'].map((name) => ({
        name,
        version: '1.2.3',
        directory: `/${name}`,
      })),
      isPublished: async (name) => visible.has(name),
      runPublish: async (pkg) => {
        if (pkg.name === 'gh-upload') {
          visible.add(pkg.name);
          return { code: 0 };
        }
        return { code: 1, stderr: 'npm authentication failed' };
      },
      setOutput: (key, value) => {
        outputs[key] = value;
      },
      maxRetries: 1,
      logger,
    }),
    /authentication failed/
  );
  assert.deepEqual([...visible], ['gh-upload']);
  assert.equal(outputs.published, undefined);
});

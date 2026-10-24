import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'test-anywhere';
import { pushToMain } from '../scripts/version-and-commit.mjs';
import {
  isBlockedByRepositoryRule,
  isNonFastForward,
} from '../scripts/push-failure-classifier.mjs';
import {
  checkReleaseNeeded,
  githubReleaseExists,
} from '../scripts/check-release-needed.mjs';
import {
  isAlreadyLandedOutput,
  publishPackages,
  VERIFICATION_ATTEMPTS,
  VERIFICATION_DELAY_MS,
} from '../scripts/publish-to-npm.mjs';

// CI-CD-BEST-PRACTICES principles 9, 10 and 17: a release that dies half-way
// must be recoverable, and every rejection must be told apart.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const quiet = { log() {} };

const NON_FAST_FORWARD = {
  code: 1,
  stderr:
    ' ! [rejected]        main -> main (non-fast-forward)\nerror: failed to push some refs',
};
const RULESET = {
  code: 1,
  stderr:
    'remote: error: GH013: Repository rule violations found for refs/heads/main.\nremote: - Changes must be made through a pull request.\n ! [remote rejected] main -> main (push declined due to repository rule violations)',
};

function scriptedRun(pushResults) {
  const commands = [];
  const run = (strings, ...values) => {
    const command = strings.reduce(
      (text, part, index) => text + part + (values[index] ?? ''),
      ''
    );
    commands.push(command);
    const result = command.startsWith('git push')
      ? pushResults.shift()
      : { code: 0, stdout: '', stderr: '' };
    return Promise.resolve(result);
  };
  return { run, commands };
}

test('push rejections are classified: a rule is never a lost race', () => {
  assert.ok(isNonFastForward(NON_FAST_FORWARD));
  assert.ok(!isBlockedByRepositoryRule(NON_FAST_FORWARD));
  assert.ok(isBlockedByRepositoryRule(RULESET));
  assert.ok(!isNonFastForward(RULESET));
  assert.ok(!isNonFastForward({ code: 128, stderr: 'Permission denied' }));
});

test('a lost race is rebased and pushed again', async () => {
  const { run, commands } = scriptedRun([NON_FAST_FORWARD, { code: 0 }]);
  const result = await pushToMain({ run, logger: quiet });
  assert.deepEqual(result, { attempt: 2 });
  assert.deepEqual(commands, [
    'git push origin main',
    'git pull --rebase origin main',
    'git push origin main',
  ]);
});

test('a repository rule fails at once with the rule and its fix', async () => {
  const { run, commands } = scriptedRun([RULESET]);
  await assert.rejects(
    pushToMain({ run, logger: quiet }),
    /repository rule refused it.*bypass actor[\s\S]*GH013/
  );
  assert.deepEqual(commands, ['git push origin main']);
});

test('other push failures and endless races are not retried forever', async () => {
  const denied = scriptedRun([{ code: 128, stderr: 'Permission denied' }]);
  await assert.rejects(
    pushToMain({ run: denied.run, logger: quiet }),
    /push version commit to main: Permission denied/
  );
  assert.deepEqual(denied.commands, ['git push origin main']);

  const racing = scriptedRun([
    NON_FAST_FORWARD,
    NON_FAST_FORWARD,
    NON_FAST_FORWARD,
  ]);
  await assert.rejects(
    pushToMain({ run: racing.run, logger: quiet, attempts: 3 }),
    /non-fast-forward/
  );
  assert.equal(
    racing.commands.filter((command) => command === 'git push origin main')
      .length,
    3
  );
});

async function decide(options) {
  const outputs = {};
  const messages = [];
  const decision = await checkReleaseNeeded({
    names: ['gh-upload-file', 'gh-upload-log'],
    version: '1.2.3',
    hasChangesets: false,
    isPublished: async () => true,
    releaseExists: async () => true,
    setOutput: (key, value) => {
      outputs[key] = value;
    },
    logger: { log: (message) => messages.push(message) },
    ...options,
  });
  return { decision, outputs, messages: messages.join('\n') };
}

test('anything to release is decided from npm and GitHub, not changesets alone', async () => {
  const changesets = await decide({ hasChangesets: true });
  assert.deepEqual(changesets.outputs, {
    should_release: 'true',
    skip_bump: 'false',
  });

  const npmMissing = await decide({
    isPublished: async (name) => name !== 'gh-upload-log',
  });
  assert.deepEqual(npmMissing.outputs, {
    should_release: 'true',
    skip_bump: 'true',
  });
  assert.ok(npmMissing.messages.includes('gh-upload-log@1.2.3 missing on npm'));

  const releaseMissing = await decide({ releaseExists: async () => false });
  assert.deepEqual(releaseMissing.outputs, {
    should_release: 'true',
    skip_bump: 'true',
  });

  const complete = await decide({});
  assert.deepEqual(complete.outputs, {
    should_release: 'false',
    skip_bump: 'false',
  });
  assert.ok(complete.messages.startsWith('::notice::No release'));
});

test('an unknown npm or GitHub state never releases', async () => {
  const npmUnknown = await decide({
    isPublished: async () => {
      throw new Error('HTTP 503');
    },
  });
  assert.equal(npmUnknown.outputs.should_release, 'false');
  assert.ok(npmUnknown.messages.includes('unknown (HTTP 503)'));

  const githubUnknown = await decide({ releaseExists: async () => null });
  assert.equal(githubUnknown.outputs.should_release, 'false');
  assert.ok(githubUnknown.messages.includes('state of v1.2.3 is unknown'));
});

test('only a GitHub 404 means the release is missing', async () => {
  const answer = (status, body) => async (url, init) => {
    assert.ok(url.endsWith('/repos/owner/repo/releases/tags/v1.2.3'), url);
    assert.equal(init.headers.Authorization, 'Bearer token');
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
    };
  };
  const options = (fetchFn) => ({
    repository: 'owner/repo',
    token: 'token',
    fetchFn,
    logger: quiet,
  });
  assert.equal(
    await githubReleaseExists('v1.2.3', options(answer(404))),
    false
  );
  assert.equal(
    await githubReleaseExists(
      'v1.2.3',
      options(answer(200, { tag_name: 'v1.2.3' }))
    ),
    true
  );
  assert.equal(await githubReleaseExists('v1.2.3', options(answer(502))), null);
  assert.equal(
    await githubReleaseExists('v1.2.3', options(answer(200, {}))),
    null
  );
});

test('E409 "previously staged" is verified on the registry, not retried', async () => {
  assert.ok(
    isAlreadyLandedOutput({
      stderr:
        'npm error code E409\nnpm error 409 Conflict - PUT https://registry.npmjs.org/gh-upload-file - Cannot publish over previously staged version',
    })
  );
  assert.ok(!isAlreadyLandedOutput({ stderr: 'npm error code E404' }));

  let publishes = 0;
  let checks = 0;
  const outputs = {};
  await publishPackages({
    packages: [
      { name: 'gh-upload-file', version: '1.2.3', directory: '/universal' },
    ],
    // Absent before the publish and for two polls after it.
    isPublished: async () => ++checks > 4,
    runPublish: async () => {
      publishes++;
      return { code: 1, stderr: 'npm error code E409' };
    },
    setOutput: (key, value) => {
      outputs[key] = value;
    },
    sleepFn: async () => {},
    logger: quiet,
  });
  assert.equal(publishes, 1);
  assert.equal(outputs.published, 'true');
});

test('every name shares one 25-minute registry window and logs its wait', async () => {
  assert.equal(
    (VERIFICATION_ATTEMPTS - 1) * VERIFICATION_DELAY_MS,
    25 * 60 * 1000
  );
  let clock = 0;
  const visibleAt = { 'gh-upload-file': 30_000, 'gh-upload-log': 50_000 };
  const published = new Set();
  const messages = [];
  let sleeps = 0;
  await publishPackages({
    packages: Object.keys(visibleAt).map((name) => ({
      name,
      version: '1.2.3',
      directory: `/${name}`,
    })),
    isPublished: async (name) =>
      published.has(name) && clock >= visibleAt[name],
    runPublish: async (pkg) => {
      published.add(pkg.name);
      return { code: 0 };
    },
    setOutput() {},
    now: () => clock,
    sleepFn: async (ms) => {
      sleeps++;
      clock += ms;
    },
    logger: { log: (message) => messages.push(message) },
  });
  assert.equal(sleeps, 5);
  assert.ok(
    messages.includes('✅ Verified gh-upload-file@1.2.3 on npm after 30s')
  );
  assert.ok(
    messages.includes('✅ Verified gh-upload-log@1.2.3 on npm after 50s')
  );
});

function runCreateRelease(mode) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'gh-upload-log-create-release-')
  );
  const fakeGh = path.join(directory, 'gh');
  const payloadCopy = path.join(directory, 'payload.json');
  fs.writeFileSync(
    path.join(directory, 'CHANGELOG.md'),
    '# gh-upload-file\n\n## 1.2.3\n\n### Patch Changes\n\n- 1234567: Fix\n\n## 1.2.2\n\n- Old\n'
  );
  fs.writeFileSync(
    path.join(directory, 'fake-gh.mjs'),
    [
      "import { readFileSync, writeFileSync } from 'node:fs';",
      'const args = process.argv.slice(2);',
      "const input = args[args.indexOf('--input') + 1];",
      `writeFileSync(${JSON.stringify(payloadCopy)}, readFileSync(input === '-' ? 0 : input));`,
      `const mode = ${JSON.stringify(mode)};`,
      "if (mode === 'exists') {",
      '  console.log(JSON.stringify({ errors: [{ code: "already_exists" }] }));',
      "  console.error('gh: Validation Failed (HTTP 422)');",
      '  process.exit(1);',
      '}',
      "if (mode === 'fail') {",
      "  console.error('gh: Resource not accessible by integration (HTTP 403)');",
      '  process.exit(1);',
      '}',
      "console.log('{}');",
      '',
    ].join('\n')
  );
  fs.writeFileSync(fakeGh, `#!${process.execPath}\nimport './fake-gh.mjs';\n`, {
    mode: 0o755,
  });
  fs.writeFileSync(
    `${fakeGh}.cmd`,
    `@echo off\r\n"${process.execPath}" "%~dp0\\fake-gh.mjs" %*\r\n`
  );
  try {
    const result = spawnSync(
      process.execPath,
      [
        path.join(root, 'scripts', 'create-github-release.mjs'),
        '--release-version',
        '1.2.3',
        '--repository',
        'owner/repository',
        '--gh-command',
        process.platform === 'win32' ? `${fakeGh}.cmd` : fakeGh,
      ],
      { cwd: directory, encoding: 'utf8' }
    );
    const payload = fs.existsSync(payloadCopy)
      ? JSON.parse(fs.readFileSync(payloadCopy, 'utf8'))
      : null;
    return {
      status: result.status,
      output: `${result.stdout || ''}${result.stderr || ''}`,
      payload,
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

// Under Bun, command-stream 0.7.1 reported exit code 0 for a failed command
// fed through `stdin`, so a refused release creation used to pass.
test('a refused GitHub release creation fails the step', () => {
  const { status, output, payload } = runCreateRelease('fail');
  assert.equal(status, 1, output);
  assert.ok(output.includes('HTTP 403'), output);
  assert.deepEqual(payload, {
    tag_name: 'v1.2.3',
    name: '1.2.3',
    body: '### Patch Changes\n\n- 1234567: Fix',
  });
});

test('an existing GitHub release is accepted on a recovery run', () => {
  const created = runCreateRelease('ok');
  assert.equal(created.status, 0, created.output);
  const existing = runCreateRelease('exists');
  assert.equal(existing.status, 0, existing.output);
  assert.ok(
    existing.output.includes('::notice::GitHub release v1.2.3 already exists'),
    existing.output
  );
});

test('the release job checks every artifact before skipping a release', () => {
  // A windows-2025 checkout stores release.yml with CRLF.
  const workflow = fs
    .readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8')
    .replaceAll('\r\n', '\n');
  assert.ok(workflow.includes('run: bun scripts/check-release-needed.mjs'));
  assert.ok(
    workflow.includes(
      "(steps.check_release.outputs.should_release == 'true' &&\n          steps.check_release.outputs.skip_bump == 'true')"
    )
  );
});

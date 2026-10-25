import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, test } from 'test-anywhere';

import {
  listBins,
  smokeTestPackage,
  INSTALL_BUDGET_MS,
} from '../scripts/smoke-test-package.mjs';
import {
  VERIFICATION_ATTEMPTS,
  VERIFICATION_DELAY_MS,
} from '../scripts/publish-to-npm.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Simulates npm and node: install writes the manifest after `failures`
// failed attempts; every other command answers with `answer(args)`.
function fakeRun({ failures = 0, manifest, answer = () => 0 }) {
  const calls = [];
  const run = (command, args, { cwd }) => {
    calls.push([command, ...args]);
    if (command !== 'npm') {
      const code = answer(args);
      return { code, stdout: code === 0 ? 'Usage' : '', output: 'boom' };
    }
    if (calls.length <= failures) {
      return { code: 1, stdout: '', output: 'npm error code E404' };
    }
    const directory = path.join(cwd, 'node_modules', manifest.name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      path.join(directory, 'package.json'),
      JSON.stringify(manifest)
    );
    return { code: 0, stdout: '', output: '' };
  };
  return { run, calls };
}

const quiet = { log() {} };
const manifest = {
  name: 'gh-upload-log',
  version: '1.2.3',
  main: 'src/index.js',
  bin: { 'gh-upload-log': 'src/cli.js', 'gh-upload': 'src/cli.js' },
};

test('smoke test runs every bin and imports the library', async () => {
  const { run, calls } = fakeRun({ manifest });
  await smokeTestPackage({
    name: 'gh-upload-log',
    version: '1.2.3',
    run,
    logger: quiet,
  });
  assert.deepEqual(calls[0].slice(0, 2), ['npm', 'install']);
  assert.equal(calls[0].at(-1), 'gh-upload-log@1.2.3');
  const helps = calls.filter((call) => call.at(-1) === '--help');
  assert.equal(helps.length, 2);
  assert.ok(
    calls.at(-1).some((arg) => arg.includes('import("gh-upload-log")'))
  );
});

test('smoke test retries an install the CDN does not serve yet', async () => {
  const { run, calls } = fakeRun({ manifest, failures: 2 });
  const delays = [];
  await smokeTestPackage({
    name: 'gh-upload-log',
    version: '1.2.3',
    run,
    sleepFn: async (ms) => delays.push(ms),
    installDelayMs: 7,
    logger: quiet,
  });
  assert.equal(calls.filter(([command]) => command === 'npm').length, 3);
  assert.deepEqual(delays, [7, 7]);
});

test('smoke test fails when the install never succeeds', async () => {
  const { run } = fakeRun({ manifest, failures: 99 });
  let error;
  try {
    await smokeTestPackage({
      name: 'gh-upload-log',
      version: '1.2.3',
      run,
      sleepFn: async () => {},
      installAttempts: 2,
      logger: quiet,
    });
  } catch (caught) {
    error = caught;
  }
  assert.match(
    error?.message ?? '',
    /npm install gh-upload-log@1\.2\.3 failed/
  );
  assert.match(error.message, /E404/);
});

test('smoke test fails on a broken bin or a wrong version', async () => {
  for (const [options, pattern] of [
    [{ answer: (args) => (args.at(-1) === '--help' ? 1 : 0) }, /--help failed/],
    [
      { answer: (args) => (args[0] === '--input-type=module' ? 1 : 0) },
      /import/,
    ],
    [{ manifest: { ...manifest, version: '1.2.2' } }, /expected 1\.2\.3/],
  ]) {
    const { run } = fakeRun({ manifest, ...options });
    let error;
    try {
      await smokeTestPackage({
        name: 'gh-upload-log',
        version: '1.2.3',
        run,
        logger: quiet,
      });
    } catch (caught) {
      error = caught;
    }
    assert.match(error?.message ?? '', pattern);
  }
});

test('listBins covers string and object bins', () => {
  assert.deepEqual(listBins({ name: 'a', bin: 'cli.js' }), { a: 'cli.js' });
  assert.deepEqual(listBins({ name: 'a' }), {});
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(Object.keys(listBins(pkg)).includes('gh-upload-log'));
});

test('both release jobs smoke-test the package before the GitHub release', () => {
  const workflow = readFileSync(
    path.join(root, '.github', 'workflows', 'release.yml'),
    'utf8'
  ).replaceAll('\r\n', '\n');
  const smoke = [
    ...workflow.matchAll(
      /node "\$RELEASE_TOOLS\/scripts\/smoke-test-package\.mjs"/g
    ),
  ];
  assert.equal(smoke.length, 2);
  for (const { index } of smoke) {
    const release = workflow.indexOf('- name: Create GitHub Release', index);
    const publish = workflow.lastIndexOf('- name: Publish to npm', index);
    assert.ok(publish !== -1 && release !== -1);
    assert.ok(
      !workflow.slice(publish, index).includes('- name: Create GitHub Release')
    );
  }
});

test('install visibility has the same 25-minute budget as publication', async () => {
  assert.equal(
    INSTALL_BUDGET_MS,
    (VERIFICATION_ATTEMPTS - 1) * VERIFICATION_DELAY_MS
  );
  const { run, calls } = fakeRun({ manifest, failures: 7 });
  let clock = 0;
  await smokeTestPackage({
    name: manifest.name,
    version: manifest.version,
    run,
    now: () => clock,
    sleepFn: async (ms) => {
      clock += ms;
    },
    logger: quiet,
  });
  assert.equal(calls.filter(([command]) => command === 'npm').length, 8);
  assert.equal(clock, 70_000);
  assert.ok(calls[0].includes('--prefer-online'));
  assert.ok(calls[0].includes('--fetch-retries=0'));
});

test('permanent install failures stop immediately with the original error', async () => {
  for (const code of [
    'E401',
    'E403',
    'ENEEDAUTH',
    'EBADENGINE',
    'EINTEGRITY',
    'ELIFECYCLE',
  ]) {
    let calls = 0;
    let error;
    try {
      await smokeTestPackage({
        name: manifest.name,
        version: manifest.version,
        run: () => {
          calls++;
          return {
            code: 1,
            output: `npm error code ${code}\noriginal diagnostic`,
          };
        },
        sleepFn: async () => {},
        logger: quiet,
      });
    } catch (caught) {
      error = caught;
    }
    assert.equal(calls, 1, code);
    assert.match(
      error?.message ?? '',
      new RegExp(`${code}\\noriginal diagnostic`)
    );
  }
});

test('install retries stop at their wall-clock deadline and retain ETARGET', async () => {
  let clock = 0;
  let calls = 0;
  const delays = [];
  let error;
  try {
    await smokeTestPackage({
      name: manifest.name,
      version: manifest.version,
      run: () => {
        calls++;
        clock += 3;
        return {
          code: 1,
          output: 'npm error code ETARGET\nNo matching version found',
        };
      },
      installBudgetMs: 20,
      installAttempts: 10,
      installDelayMs: 10,
      now: () => clock,
      sleepFn: async (ms) => {
        delays.push(ms);
        clock += ms;
      },
      logger: quiet,
    });
  } catch (caught) {
    error = caught;
  }
  assert.equal(calls, 2);
  assert.deepEqual(delays, [10, 4]);
  assert.equal(clock, 20);
  assert.match(error?.message ?? '', /ETARGET\nNo matching version found/);
});

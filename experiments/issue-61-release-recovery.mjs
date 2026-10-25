// Finite local-Git release lifecycle. Git, changeset merging, tarball packing,
// consumer installation, CLI execution and imports are real. Only the registry,
// propagation clock, version transformation and GitHub API are simulated.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  prepareReleaseCheckout,
  gitOutput,
} from '../scripts/prepare-release-checkout.mjs';
import { versionAndCommit } from '../scripts/version-and-commit.mjs';
import {
  preparePackages,
  publishPackages,
} from '../scripts/publish-to-npm.mjs';
import { checkReleaseNeeded } from '../scripts/check-release-needed.mjs';
import {
  smokeTestPackage,
  INSTALL_BUDGET_MS,
} from '../scripts/smoke-test-package.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-61-release-'));
const logger =
  process.env.RELEASE_RECOVERY_VERBOSE === '1' ? console : { log() {} };
const origin = path.join(directory, 'origin.git');
const first = path.join(directory, 'first');
const retry = path.join(directory, 'retry');
const snapshots = [];
const git = (cwd, ...args) => gitOutput(args, { cwd });
const read = (cwd) =>
  JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
const write = (cwd, file, text) => fs.writeFileSync(path.join(cwd, file), text);
const count = (cwd) =>
  fs
    .readdirSync(path.join(cwd, '.changeset'))
    .filter((file) => file.endsWith('.md') && file !== 'README.md').length;

function run(command, args, { cwd, timeout = 30_000 } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    timeout,
    encoding: 'utf8',
    shell:
      process.platform === 'win32' &&
      (command === 'npm' || command.endsWith('.cmd')),
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=128' },
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout || '',
    output: `${result.stdout || ''}${result.stderr || ''}${result.error?.message || ''}`,
  };
}

function versionStream(cwd, events) {
  return (strings, ...values) => {
    const command = strings.reduce(
      (text, part, index) => text + part + (values[index] ?? ''),
      ''
    );
    events.push(command);
    let result;
    if (
      command === 'npm run changeset:version' ||
      command.startsWith('node scripts/instant-version-bump.mjs')
    ) {
      const files = fs
        .readdirSync(path.join(cwd, '.changeset'))
        .filter((file) => file.endsWith('.md'));
      if (command === 'npm run changeset:version') {
        assert.equal(
          files.length,
          1,
          'the actual merger combines both changesets before consumption'
        );
        const merged = fs.readFileSync(
          path.join(cwd, '.changeset', files[0]),
          'utf8'
        );
        assert.match(merged, /First fix/);
        assert.match(merged, /Second fix/);
      }
      const pkg = read(cwd);
      pkg.version = '1.1.0';
      write(cwd, 'package.json', JSON.stringify(pkg));
      write(
        cwd,
        'CHANGELOG.md',
        '# Fixture\n\n## 1.1.0\n\n### Minor Changes\n\n- First fix\n- Second fix\n\n## 1.0.0\n\n- Old\n'
      );
      for (const file of files) {
        fs.unlinkSync(path.join(cwd, '.changeset', file));
      }
      result = { code: 0, stdout: '' };
    } else if (command === 'node scripts/merge-changesets.mjs') {
      result = run(
        process.execPath,
        [path.join(root, 'scripts/merge-changesets.mjs')],
        { cwd }
      );
    } else {
      assert.ok(command.startsWith('git '), command);
      // Only the fixed commands from version-and-commit, with a quoted bot name.
      const args = command
        .slice(4)
        .match(/"[^"]*"|\S+/g)
        .map((arg) => arg.replace(/^"|"$/g, ''));
      result = run('git', args, { cwd });
      result.stderr = result.output;
    }
    const promise = Promise.resolve(result);
    promise.run = () => Promise.resolve(result);
    return promise;
  };
}

async function lifecycle(mode) {
  git(directory, 'init', '--bare', '--initial-branch=main', origin);
  git(directory, 'clone', origin, first);
  git(first, 'config', 'user.name', 'Release Fixture');
  git(first, 'config', 'user.email', 'fixture@example.com');
  fs.mkdirSync(path.join(first, '.changeset'));
  write(first, '.changeset/config.json', '{}\n');
  fs.mkdirSync(path.join(first, 'src'));
  write(
    first,
    'package.json',
    JSON.stringify({
      name: 'gh-upload-file',
      version: '1.0.0',
      type: 'module',
      main: 'src/index.js',
      publishAliases: ['gh-upload-log'],
      bin: {
        'gh-upload': 'src/cli.js',
        'gh-upload-file': 'src/cli.js',
        'gh-upload-log': 'src/cli.js',
      },
    })
  );
  write(first, 'src/index.js', 'export const uploadFile = () => "fixture";\n');
  write(
    first,
    'src/cli.js',
    '#!/usr/bin/env node\nconsole.log("Usage: fixture --help");\n'
  );
  for (const file of ['LICENSE', 'README.md', 'CHANGELOG.md']) {
    write(first, file, '# Fixture\n');
  }
  if (mode === 'changeset') {
    for (const [name, text] of [
      ['first', 'First fix'],
      ['second', 'Second fix'],
    ]) {
      write(
        first,
        `.changeset/${name}.md`,
        `---\n'gh-upload-file': minor\n---\n\n${text}\n`
      );
    }
  }
  git(first, 'add', '-A');
  git(first, 'commit', '-m', 'Original workflow source');
  git(first, 'push', 'origin', 'main');
  const source = git(first, 'rev-parse', 'HEAD');
  // A second Actions checkout is detached at the original run's SHA.
  git(directory, 'clone', origin, retry);
  git(retry, 'checkout', '--detach', source);
  // A normal intervening commit must not be mistaken for a version bump.
  write(first, 'README.md', '# Fixture\n\nIntervening documentation change\n');
  git(first, 'add', '-A');
  git(first, 'commit', '-m', 'Main advances without changing version');
  git(first, 'push', 'origin', 'main');
  const prepared = prepareReleaseCheckout({
    cwd: first,
    sourceSha: source,
    setOutput() {},
    logger,
  });
  assert.equal(prepared.recoveredVersion, '');
  assert.throws(
    () =>
      prepareReleaseCheckout({
        cwd: first,
        sourceSha: source,
        recoveryOnly: true,
        setOutput() {},
        logger,
      }),
    /No version commit/
  );
  const events = [];
  const outputs = {};
  await versionAndCommit({
    mode,
    bumpType: 'minor',
    $: versionStream(first, events),
    readVersion: () => read(first).version,
    changesetCount: () => count(first),
    logger,
    setOutput: (key, value) => {
      outputs[key] = value;
    },
  });
  assert.equal(outputs.version_committed, 'true');
  const versionCommit = git(first, 'rev-parse', 'HEAD');
  const published = new Map();
  let publishes = 0;
  const publish = async (
    cwd,
    publishing = { preparePackages, publishPackages }
  ) => {
    const packages = publishing.preparePackages({
      sourceDir: cwd,
      outputDir: path.join(directory, `packages-${publishes}`),
    });
    const results = {};
    await publishing.publishPackages({
      packages,
      logger,
      isPublished: (name, version) => published.get(name)?.version === version,
      runPublish: (pkg) => {
        publishes++;
        published.set(pkg.name, pkg);
        return { code: 0 };
      },
      setOutput: (key, value) => {
        results[key] = value;
      },
    });
    return results;
  };
  assert.equal((await publish(first)).published, 'true');
  assert.equal(publishes, 2);
  let clock = 0;
  let installs = 0;
  await assert.rejects(
    smokeTestPackage({
      name: 'gh-upload-file',
      version: '1.1.0',
      logger,
      run: () => {
        installs++;
        return {
          code: 1,
          output:
            'npm error code ETARGET\nNo matching version found for gh-upload-file@1.1.0',
        };
      },
      now: () => clock,
      sleepFn: (ms) => {
        clock += ms;
      },
    }),
    /ETARGET/
  );
  assert.equal(clock, INSTALL_BUDGET_MS);
  assert.equal(installs, 150);

  // Main has new unconsumed work AND a later version. Neither belongs to
  // the original run; recovery must select its exact first version commit.
  write(
    first,
    '.changeset/later.md',
    "---\n'gh-upload-file': patch\n---\n\nLater work\n"
  );
  git(first, 'add', '-A');
  git(first, 'commit', '-m', 'New work after original release');
  const later = { ...read(first), version: '1.2.0' };
  write(first, 'package.json', JSON.stringify(later));
  git(first, 'add', '-A');
  git(first, 'commit', '-m', 'Later version');
  git(first, 'push', 'origin', 'main');
  const remoteHead = git(first, 'rev-parse', 'HEAD');
  write(retry, 'README.md', 'Uncommitted work\n');
  assert.throws(
    () =>
      prepareReleaseCheckout({
        cwd: retry,
        sourceSha: source,
        setOutput() {},
        logger,
      }),
    /must be clean/
  );
  assert.equal(git(retry, 'rev-parse', 'HEAD'), source);
  assert.equal(
    fs.readFileSync(path.join(retry, 'README.md'), 'utf8'),
    'Uncommitted work\n'
  );
  git(retry, 'restore', 'README.md');
  const recovery = prepareReleaseCheckout({
    cwd: retry,
    sourceSha: source,
    recoveryOnly: true,
    preserveTools: true,
    setOutput() {},
    logger,
  });
  snapshots.push(recovery.toolsDirectory);
  // The historical fixture has no release scripts at all. Current tooling
  // must survive the old source checkout and remain executable from outside it.
  assert.ok(!fs.existsSync(path.join(retry, 'scripts')));
  assert.equal(
    fs.readFileSync(
      path.join(recovery.toolsDirectory, 'scripts/smoke-test-package.mjs'),
      'utf8'
    ),
    fs.readFileSync(path.join(root, 'scripts/smoke-test-package.mjs'), 'utf8')
  );
  const toolInstall = run('bun', ['install', '--frozen-lockfile'], {
    cwd: recovery.toolsDirectory,
    timeout: 60_000,
  });
  assert.equal(toolInstall.code, 0, toolInstall.output);
  const recoveredPublishing = await import(
    pathToFileURL(
      path.join(recovery.toolsDirectory, 'scripts/publish-to-npm.mjs')
    ).href
  );
  const { smokeTestPackage: recoveredSmokeTest } = await import(
    pathToFileURL(
      path.join(recovery.toolsDirectory, 'scripts/smoke-test-package.mjs')
    ).href
  );
  assert.equal(recovery.recoveredVersion, '1.1.0');
  assert.equal(recovery.releaseCommit, versionCommit);
  assert.equal(read(retry).version, '1.1.0');
  assert.equal(count(retry), 0);
  assert.equal(git(retry, 'status', '--porcelain'), '');
  const decision = await checkReleaseNeeded({
    hasChangesets: count(retry) > 0,
    names: [...published.keys()],
    version: recovery.version,
    isPublished: () => true,
    releaseExists: () => false,
    setOutput() {},
    logger,
  });
  assert.deepEqual(decision, { shouldRelease: true, skipBump: true });
  assert.equal(
    (await publish(retry, recoveredPublishing)).already_published,
    'true'
  );
  assert.equal(
    publishes,
    2,
    'recovery cannot attempt an immutable-version publication'
  );

  // Pack the recovered artifacts, then genuinely install each tarball in
  // the smoke tester's clean project. Only preceding registry misses are fake.
  for (const [name, pkg] of published) {
    const packed = run(
      'npm',
      ['pack', pkg.directory, '--pack-destination', directory, '--json'],
      { cwd: directory }
    );
    assert.equal(packed.code, 0, packed.output);
    const tarball = path.join(directory, JSON.parse(packed.stdout)[0].filename);
    let attempts = 0;
    const checks = [];
    await recoveredSmokeTest({
      name,
      version: recovery.version,
      logger,
      now: () => clock,
      sleepFn: (ms) => {
        clock += ms;
      },
      run: (command, args, options) => {
        if (command === 'npm') {
          attempts++;
          if (attempts <= 7) {
            return {
              code: 1,
              output: `npm error code ETARGET\nNo matching version found for ${name}@1.1.0`,
            };
          }
          assert.equal(args.at(-1), `${name}@1.1.0`);
          assert.ok(args.includes('--prefer-online'));
          return run(command, [...args.slice(0, -1), tarball], options);
        }
        checks.push(args);
        return run(command, args, options);
      },
    });
    assert.equal(attempts, 8);
    assert.equal(checks.filter((args) => args.at(-1) === '--help').length, 3);
    assert.equal(checks.length, 4, 'also imported the installed library');
  }

  const fakeGh = path.join(directory, 'fake-gh');
  const payloadFile = path.join(directory, 'release-payload.json');
  const ghCode = `import fs from 'node:fs'; const args=process.argv.slice(2); fs.copyFileSync(args[args.indexOf('--input')+1], ${JSON.stringify(payloadFile)}); console.log('{}');\n`;
  write(directory, 'fake-gh.mjs', ghCode);
  fs.writeFileSync(fakeGh, `#!${process.execPath}\n${ghCode}`, { mode: 0o755 });
  fs.writeFileSync(
    `${fakeGh}.cmd`,
    `@echo off\r\n"${process.execPath}" "%~dp0fake-gh.mjs" %*\r\n`
  );
  const created = run(
    process.execPath,
    [
      path.join(recovery.toolsDirectory, 'scripts/create-github-release.mjs'),
      '--release-version',
      recovery.version,
      '--repository',
      'fixture/repository',
      '--target-commit',
      versionCommit,
      '--gh-command',
      process.platform === 'win32' ? `${fakeGh}.cmd` : fakeGh,
    ],
    { cwd: retry }
  );
  assert.equal(created.code, 0, created.output);
  const payload = JSON.parse(fs.readFileSync(payloadFile, 'utf8'));
  assert.equal(payload.tag_name, 'v1.1.0');
  assert.equal(payload.target_commitish, versionCommit);
  assert.match(payload.body, /First fix/);
  assert.ok(!payload.body.includes('Later work'));
  assert.equal(
    git(retry, 'ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0],
    remoteHead
  );
  assert.equal(git(retry, 'status', '--porcelain'), '');
  console.log(
    JSON.stringify({
      mode,
      source,
      versionCommit,
      recoveredVersion: recovery.version,
      publishes,
      initialInstallAttempts: installs,
      recovery:
        'both names installed; three bins and import passed; exact GitHub release payload verified',
    })
  );
}

try {
  await lifecycle(process.argv[2] || 'changeset');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
  for (const snapshot of snapshots) {
    fs.rmSync(snapshot, { recursive: true, force: true });
  }
}

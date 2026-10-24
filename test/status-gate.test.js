import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, test } from 'test-anywhere';
import { itUnless, sandboxed, windowsBash } from './helpers/skip.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'status-gate-'));
}

// A comment, a blank line or a trailing comment inside `needs:` ended the
// list, so every later job was reported as a hole (template issue #253).
test('gate coverage reads needs lists with comments and blank lines', () => {
  const dir = tempDir();
  const workflow = path.join(dir, 'demo.yml');
  fs.writeFileSync(
    workflow,
    [
      'name: Demo',
      'on: push',
      'jobs:',
      '  lint:',
      '    runs-on: ubuntu-latest',
      '    steps: []',
      '  test:',
      '    runs-on: ubuntu-latest',
      '    steps: []',
      '  release:',
      '    runs-on: ubuntu-latest',
      '    steps: []',
      '  pipeline-status:',
      '    needs:',
      '      - lint',
      '      # Release jobs',
      '',
      '      - test',
      '      - release # publishes',
      '    if: always()',
      '    runs-on: ubuntu-latest',
      '    steps: []',
      '',
    ].join('\n')
  );
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, 'scripts/check-status-gate-covers-all-jobs.mjs'),
      workflow,
    ],
    { encoding: 'utf8' }
  );
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('every gate compares the run with the pull request ref, not a branch name', () => {
  for (const name of ['links', 'release', 'security', 'workflows']) {
    const workflow = fs.readFileSync(
      path.join(root, '.github/workflows', `${name}.yml`),
      'utf8'
    );
    assert.ok(
      workflow.includes(
        "HEAD_REF: ${{ github.event_name == 'pull_request' && format('refs/pull/{0}/head', github.event.pull_request.number) || github.ref }}"
      ),
      `${name}.yml gate does not pass HEAD_REF`
    );
  }
});

// A fork pull request from a branch named like one here (main) was judged
// against this repository's main, so a cancellation nothing caused passed.
itUnless(sandboxed, windowsBash)(
  'the gate resolves the run head through HEAD_REF',
  () => {
    const remote = tempDir();
    const git = (...args) =>
      execFileSync('git', ['-C', remote, ...args], { encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'main');
    const commit = (message) => {
      git(
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@example.com',
        'commit',
        '-q',
        '--allow-empty',
        '-m',
        message
      );
      return git('rev-parse', 'HEAD');
    };
    const forkHead = commit('fork head');
    git('update-ref', 'refs/pull/7/head', forkHead);
    const baseMain = commit('base main moved on');

    const result = spawnSync('bash', ['scripts/check-pipeline-status.sh'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NEEDS_JSON: JSON.stringify({ codeql: { result: 'cancelled' } }),
        RUN_SHA: forkHead,
        BRANCH_NAME: 'main',
        HEAD_REF: 'refs/pull/7/head',
        GIT_REMOTE: remote,
      },
    });
    fs.rmSync(remote, { recursive: true, force: true });

    assert.ok(
      result.stdout.includes(
        `This run tests ${forkHead}; main is at ${forkHead}.`
      ),
      result.stdout + result.stderr
    );
    assert.ok(!result.stdout.includes(baseMain));
    // Nothing overtook the run, so the cancellation is unexplained.
    assert.equal(result.status, 1);
  }
);

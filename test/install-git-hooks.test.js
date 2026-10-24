import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, test } from 'test-anywhere';
import { installGitHooks } from '../scripts/install-git-hooks.mjs';

const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'install-git-hooks.mjs'
);

function capture() {
  const lines = [];
  return {
    lines,
    logger: { log: (line) => lines.push(line), error: (l) => lines.push(l) },
  };
}

function workspace({ withGit }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'git-hooks-'));
  if (withGit) {
    mkdirSync(path.join(dir, '.git'));
  }
  return dir;
}

test('CI and HUSKY=0 skip the hook install without loading husky', async () => {
  for (const env of [{ CI: 'true' }, { HUSKY: '0' }]) {
    let loaded = false;
    const code = await installGitHooks({
      env,
      loadHusky: async () => {
        loaded = true;
        return () => '';
      },
    });
    assert.equal(code, 0);
    assert.equal(loaded, false);
  }
});

test('a consumer install without .git is not an error', async () => {
  const cwd = workspace({ withGit: false });
  try {
    const code = await installGitHooks({
      env: {},
      cwd,
      loadHusky: async () => {
        throw new Error('husky must not be loaded');
      },
    });
    assert.equal(code, 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('husky exiting quietly without hooks fails instead of passing', async () => {
  const cwd = workspace({ withGit: true });
  const out = capture();
  try {
    const code = await installGitHooks({
      env: {},
      cwd,
      loadHusky: async () => () => 'fatal: not in a git directory\n',
      getHooksPath: () => '',
      logger: out.logger,
    });
    assert.equal(code, 1);
    assert.deepEqual(out.lines, [
      'git hooks were not installed: fatal: not in a git directory',
    ]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('a missing husky package is reported, and verbose is off by default', async () => {
  const cwd = workspace({ withGit: true });
  const out = capture();
  try {
    const code = await installGitHooks({
      env: {},
      cwd,
      loadHusky: async () => {
        throw new Error("Cannot find package 'husky'");
      },
      logger: out.logger,
    });
    assert.equal(code, 1);
    assert.deepEqual(out.lines, [
      "git hooks were not installed: Cannot find package 'husky'",
    ]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('installed hooks pass and GIT_HOOKS_VERBOSE=1 traces the decision', async () => {
  const cwd = workspace({ withGit: true });
  const out = capture();
  try {
    const code = await installGitHooks({
      env: { GIT_HOOKS_VERBOSE: '1' },
      cwd,
      loadHusky: async () => () => '',
      getHooksPath: () => '.husky/_',
      logger: out.logger,
    });
    assert.equal(code, 0);
    assert.ok(out.lines.includes('git hooks: core.hooksPath=".husky/_"'));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('the script installs husky hooks into a real repository', () => {
  const cwd = workspace({ withGit: false });
  try {
    spawnSync('git', ['init', '--quiet'], { cwd });
    const env = { ...process.env };
    delete env.CI;
    delete env.HUSKY;
    const result = spawnSync(process.execPath, [script], {
      cwd,
      env,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const hooksPath = spawnSync('git', ['config', '--get', 'core.hooksPath'], {
      cwd,
      encoding: 'utf8',
    });
    assert.equal(hooksPath.stdout.trim(), '.husky/_');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

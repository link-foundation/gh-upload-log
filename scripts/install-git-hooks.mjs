#!/usr/bin/env node
// `husky || true` hid every failure, and husky itself never throws: it
// returns a message such as ".git can't be found" and the process exits 0.
// The pre-commit hook therefore never ran (issue #59). Verify the outcome
// instead: after husky runs, `git config --get core.hooksPath` must name the
// installed hooks. Ported from the pipeline template's install-git-hooks.mjs,
// calling husky's API instead of `npx husky` so it also works on Windows.
//
// Set GIT_HOOKS_VERBOSE=1 to log each decision.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function readHooksPath(cwd) {
  // `git config --get` exits 1 when the key is unset, which is exactly the
  // case this script exists to catch.
  const result = spawnSync('git', ['config', '--get', 'core.hooksPath'], {
    cwd,
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

export async function installGitHooks({
  env = process.env,
  cwd = process.cwd(),
  loadHusky = async () => (await import('husky')).default,
  getHooksPath = readHooksPath,
  logger = console,
} = {}) {
  const debug = (line) => env.GIT_HOOKS_VERBOSE === '1' && logger.log(line);
  if (env.CI || env.HUSKY === '0') {
    debug('git hooks: skipped (CI or HUSKY=0)');
    return 0;
  }
  // A consumer installing this package as a dependency has no .git of its own.
  if (!existsSync(path.join(cwd, '.git'))) {
    debug(`git hooks: skipped (no .git in ${cwd})`);
    return 0;
  }
  let husky;
  try {
    husky = await loadHusky();
  } catch (error) {
    logger.error(`git hooks were not installed: ${error.message}`);
    return 1;
  }
  const message = husky().trim();
  debug(`git hooks: husky returned "${message}"`);
  const hooksPath = getHooksPath(cwd);
  debug(`git hooks: core.hooksPath="${hooksPath}"`);
  if (!hooksPath) {
    logger.error(
      `git hooks were not installed: ${message || 'husky said nothing'}`
    );
    return 1;
  }
  return 0;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await installGitHooks();
}

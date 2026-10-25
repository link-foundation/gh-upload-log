#!/usr/bin/env node

/**
 * Install-from-registry smoke test for every published npm name (the
 * pipeline template's smoke-test-package.mjs). The publish step proves npm
 * accepted the tarball; this proves a consumer can install it, run every
 * bin and import the library from a clean project, outside this checkout.
 *
 * Usage: node scripts/smoke-test-package.mjs --package-version <version>
 * Environment: PACKAGE_VERSION, SMOKE_TEST_VERBOSE=1 prints every command
 * and its output.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const INSTALL_BUDGET_MS = 25 * 60 * 1000;
const INSTALL_ATTEMPTS = 151;
const INSTALL_DELAY_MS = 10_000;

export function isTransientInstallFailure(output) {
  if (
    /\b(E401|E403|ENEEDAUTH|EBADENGINE|EINTEGRITY|ELIFECYCLE)\b/i.test(output)
  ) {
    return false;
  }
  return /\b(ETARGET|E404|E408|E429|E5\d\d|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT)\b|npm (?:error|ERR!) (?:404|408|429|5\d\d)\b/i.test(
    output
  );
}

function runCommand(
  command,
  args,
  { cwd, verbose = false, timeout = 300_000 }
) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    // npm is npm.cmd on Windows, which only a shell can start.
    shell: process.platform === 'win32' && command === 'npm',
    timeout,
  });
  const output = `${result.stdout || ''}${result.stderr || ''}${result.error ? `\n${result.error.code}: ${result.error.message}` : ''}`;
  if (verbose) {
    console.log(`$ ${command} ${args.join(' ')}\n${output}`);
  }
  return { code: result.status ?? 1, stdout: result.stdout || '', output };
}

/** The bins a consumer gets, keyed by command name. */
export function listBins(manifest) {
  if (!manifest.bin) {
    return {};
  }
  if (typeof manifest.bin === 'string') {
    return { [manifest.name]: manifest.bin };
  }
  return manifest.bin;
}

export async function smokeTestPackage({
  name,
  version,
  run = runCommand,
  sleepFn = (ms) =>
    new Promise((resolve) => globalThis.setTimeout(resolve, ms)),
  installAttempts = INSTALL_ATTEMPTS,
  installDelayMs = INSTALL_DELAY_MS,
  installBudgetMs = INSTALL_BUDGET_MS,
  now = Date.now,
  logger = console,
  verbose = false,
}) {
  const workspace = mkdtempSync(path.join(tmpdir(), 'smoke-test-package-'));
  try {
    writeFileSync(
      path.join(workspace, 'package.json'),
      `${JSON.stringify({ name: 'smoke-test', private: true, type: 'module' })}\n`
    );
    // Exact-version documents can precede the packument/CDN used by install.
    // Bound commands AND sleeps by elapsed time; npm's own retries must not
    // multiply this budget. Runtime validation below is never retried.
    const deadline = now() + installBudgetMs;
    let install;
    for (let attempt = 1; attempt <= installAttempts; attempt++) {
      const remaining = deadline - now();
      if (remaining <= 0) {
        break;
      }
      install = run(
        'npm',
        [
          'install',
          '--no-audit',
          '--no-fund',
          '--no-package-lock',
          '--prefer-online',
          '--fetch-retries=0',
          '--cache=.npm-cache',
          `${name}@${version}`,
        ],
        { cwd: workspace, verbose, timeout: Math.min(300_000, remaining) }
      );
      if (install.code === 0) {
        break;
      }
      logger.log(
        `npm install ${name}@${version} failed (attempt ${attempt}/${installAttempts}, ${Math.max(0, Math.ceil((deadline - now()) / 1000))}s left):\n${install.output.trim()}`
      );
      if (!isTransientInstallFailure(install.output)) {
        break;
      }
      if (attempt < installAttempts && now() < deadline) {
        await sleepFn(Math.min(installDelayMs, deadline - now()));
      }
    }
    if (install?.code !== 0) {
      throw new Error(
        `npm install ${name}@${version} failed:\n${install?.output.trim() || 'Registry visibility budget exhausted before installation'}`
      );
    }

    const packageDir = path.join(workspace, 'node_modules', name);
    const manifest = JSON.parse(
      readFileSync(path.join(packageDir, 'package.json'), 'utf8')
    );
    if (manifest.version !== version) {
      throw new Error(
        `Installed ${name}@${manifest.version}, expected ${version}`
      );
    }

    for (const [bin, binPath] of Object.entries(listBins(manifest))) {
      const help = run(
        process.execPath,
        [path.join(packageDir, binPath), '--help'],
        { cwd: workspace, verbose }
      );
      if (help.code !== 0 || !help.stdout.trim()) {
        throw new Error(`${bin} --help failed:\n${help.output.trim()}`);
      }
      logger.log(`✅ ${name}@${version}: ${bin} --help`);
    }

    if (manifest.main || manifest.exports) {
      const load = run(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `const m = await import(${JSON.stringify(name)}); if (!Object.keys(m).length) { throw new Error('no exports'); }`,
        ],
        { cwd: workspace, verbose }
      );
      if (load.code !== 0) {
        throw new Error(`import('${name}') failed:\n${load.output.trim()}`);
      }
      logger.log(`✅ ${name}@${version}: import('${name}')`);
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const flag = process.argv.indexOf('--package-version');
  const version =
    flag === -1 ? process.env.PACKAGE_VERSION : process.argv[flag + 1];
  if (!version) {
    console.error('Usage: smoke-test-package.mjs --package-version <version>');
    process.exit(1);
  }
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const verbose = process.env.SMOKE_TEST_VERBOSE === '1';
  try {
    const deadline = Date.now() + INSTALL_BUDGET_MS;
    for (const name of [pkg.name, ...(pkg.publishAliases || [])]) {
      await smokeTestPackage({
        name,
        version,
        verbose,
        installBudgetMs: Math.max(0, deadline - Date.now()),
      });
    }
  } catch (error) {
    console.error(`::error title=npm smoke test failed::${error.message}`);
    process.exit(1);
  }
}

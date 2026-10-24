/**
 * Register a test as skipped, with the reason in its name, when the runner
 * cannot run it. A test that returns early instead is reported as passed
 * without asserting anything, and one left unregistered vanishes from the
 * summary. Ported from the pipeline template's tests/helpers/skip.js.
 */

import { it } from 'test-anywhere';

const deno = globalThis.Deno;

const DENO_PERMISSIONS = ['read', 'write', 'run', 'env', 'sys', 'net', 'ffi'];

/**
 * @param {typeof globalThis.Deno} [runtime]
 * @returns {string[]} Deno permissions this run was not granted
 */
export function missingDenoPermissions(runtime = deno) {
  if (!runtime) {
    return [];
  }
  return DENO_PERMISSIONS.filter(
    (name) => runtime.permissions.querySync({ name }).state !== 'granted'
  );
}

const missing = missingDenoPermissions();

/**
 * Fixtures write temporary trees, spawn processes and start local servers;
 * Deno allows all of that only under `deno test -A`.
 */
export const sandboxed =
  missing.length > 0
    ? `Deno lacks ${missing.map((name) => `--allow-${name}`).join(' ')}; run deno test -A`
    : null;

/**
 * @param {...(string|null|undefined|false)} reasons first truthy one wins
 * @returns {typeof it} `it`, or a registrar that reports the test as skipped
 */
export function itUnless(...reasons) {
  const reason = reasons.find(Boolean);
  if (!reason) {
    return it;
  }
  return (name, fn) => it.skip(`${name} [skipped: ${reason}]`, fn);
}

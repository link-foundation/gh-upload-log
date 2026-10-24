#!/usr/bin/env bun

/**
 * Detect which kinds of files changed so the workflow can skip checks that
 * cannot be affected (hive-mind CI/CD principle #1, docs-only exemption #6).
 *
 * Ranges:
 * - pull_request: GITHUB_BASE_SHA..HEAD^2 (the whole PR, never just the last
 *   push, because a superseded run may not have tested earlier commits).
 * - push: GITHUB_BEFORE_SHA..HEAD when the push carries a real before SHA,
 *   otherwise HEAD^1..HEAD (first-parent diff), otherwise every tracked file.
 *
 * Anything that is not documentation or development metadata counts as code,
 * so an unknown file type (a lockfile, a shell script, bunfig.toml) can never
 * skip the tests.
 *
 * Outputs (GITHUB_OUTPUT): js-changed, docs-changed, any-code-changed
 * Verbose: DETECT_CHANGES_VERBOSE=1 traces every git command.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const IGNORED_PREFIXES = [
  '.changeset/',
  'dev/log/',
  'docs/case-studies/',
  'examples/',
  'experiments/',
];

const verbose = process.env.DETECT_CHANGES_VERBOSE === '1';

function isIgnored(file) {
  return (
    IGNORED_PREFIXES.some((prefix) => file.startsWith(prefix)) ||
    path.posix.basename(file) === '.gitkeep'
  );
}

function isDocumentation(file) {
  return file.endsWith('.md') || file.startsWith('docs/');
}

/** Classify changed paths into the workflow outputs. */
export function classifyChanges(files) {
  const relevant = files.filter((file) => !isIgnored(file));
  const code = relevant.filter((file) => !isDocumentation(file));
  return {
    'js-changed': relevant.some((file) => /\.(mjs|cjs|js)$/.test(file)),
    'docs-changed': relevant.some(isDocumentation),
    'any-code-changed': code.length > 0,
    codeFiles: code,
  };
}

function git(args) {
  if (verbose) {
    console.log(`[detect-changes] git ${args.join(' ')}`);
  }
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function lines(output) {
  return output ? output.split('\n').filter(Boolean) : [];
}

function realSha(sha) {
  return sha && !/^0+$/.test(sha) ? sha : '';
}

/** Choose and run the diff that describes this event. */
export function getChangedFiles(env = process.env, run = git) {
  const baseSha = realSha(env.GITHUB_BASE_SHA);
  const beforeSha = realSha(env.GITHUB_BEFORE_SHA);
  const attempts = [];
  if (env.GITHUB_EVENT_NAME === 'pull_request' && baseSha) {
    attempts.push(['diff', '--name-only', baseSha, 'HEAD^2']);
    attempts.push(['diff', '--name-only', baseSha, 'HEAD']);
  }
  if (env.GITHUB_EVENT_NAME === 'push' && beforeSha) {
    attempts.push(['diff', '--name-only', beforeSha, 'HEAD']);
  }
  attempts.push(['diff', '--name-only', 'HEAD^1', 'HEAD']);
  for (const args of attempts) {
    try {
      console.log(`Comparing: git ${args.join(' ')}`);
      return lines(run(args));
    } catch (error) {
      console.log(`Range unavailable (${error.message.split('\n')[0]})`);
    }
  }
  console.log('No usable range; treating every tracked file as changed');
  return lines(run(['ls-files']));
}

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
  console.log(`${name}=${value}`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const files = getChangedFiles();
  console.log(`Changed files:\n${files.map((f) => `  ${f}`).join('\n')}`);
  const result = classifyChanges(files);
  console.log(
    `Code changes:\n${result.codeFiles.map((f) => `  ${f}`).join('\n') || '  (none)'}`
  );
  for (const name of ['js-changed', 'docs-changed', 'any-code-changed']) {
    setOutput(name, String(result[name]));
  }
  if (!result['any-code-changed']) {
    console.log(
      '::notice title=No code changes::Only documentation or development metadata changed; changeset and test jobs are skipped.'
    );
  }
}

#!/usr/bin/env bun

/**
 * Check tracked files against the line limits (best-practices principles 2
 * and 12): 1000 lines for JavaScript, matching the ESLint `max-lines` rule,
 * and 1500 for Markdown and workflow YAML, like the pipeline template's
 * check-file-line-limits.sh.
 *
 * Walks `git ls-files` so git-ignored output (node_modules, test fixtures,
 * coverage) is never flagged, while documentation and workflows can no
 * longer slip past a check that used to read JavaScript only.
 *
 * Exits with 1 and a `::error file=...` annotation per violation.
 * Set DEBUG=1 to print every checked file and its line count.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIMITS = [
  { extensions: ['.js', '.mjs', '.cjs'], maxLines: 1000 },
  { extensions: ['.md', '.yml', '.yaml'], maxLines: 1500 },
];

// Captured evidence (saved web pages, CI logs, case studies) is kept
// verbatim, as the template's check excludes its case studies.
export const EXCLUDED_PREFIXES = ['docs/case-studies/', 'dev/log/'];

export function limitFor(file) {
  if (EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix))) {
    return null;
  }
  const extension = path.extname(file).toLowerCase();
  const limit = LIMITS.find((entry) => entry.extensions.includes(extension));
  return limit ? limit.maxLines : null;
}

export function countLines(content) {
  return content.split('\n').length;
}

export function findViolations(files, readFile) {
  const violations = [];
  const checked = [];
  for (const file of files) {
    const maxLines = limitFor(file);
    if (maxLines === null) {
      continue;
    }
    const lines = countLines(readFile(file));
    checked.push({ file, lines, maxLines });
    if (lines > maxLines) {
      violations.push({ file, lines, maxLines });
    }
  }
  return { checked, violations };
}

function listTrackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

function main() {
  const { checked, violations } = findViolations(listTrackedFiles(), (file) =>
    readFileSync(file, 'utf8')
  );
  if (process.env.DEBUG) {
    for (const entry of checked) {
      console.log(`  ${entry.file}: ${entry.lines}/${entry.maxLines}`);
    }
  }
  console.log(
    `\nChecked ${checked.length} files (JavaScript <= 1000 lines, Markdown and YAML <= 1500 lines).\n`
  );
  if (violations.length === 0) {
    console.log('✓ All files are within the line limit\n');
    return 0;
  }
  console.error('✗ Found files exceeding the line limit:\n');
  for (const { file, lines, maxLines } of violations) {
    console.error(`  ${file}: ${lines} lines (exceeds ${maxLines})`);
    console.log(
      `::error file=${file}::File has ${lines} lines (limit: ${maxLines}). Split it into smaller files.`
    );
  }
  return 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error('Error:', error.message);
    if (process.env.DEBUG) {
      console.error('Stack trace:', error.stack);
    }
    process.exitCode = 1;
  }
}

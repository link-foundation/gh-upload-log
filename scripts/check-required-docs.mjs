#!/usr/bin/env node

/**
 * Verify that required documents exist AND still contain their required
 * level-2 headings (best-practices principle 12). A deleted file shows up in
 * any diff as a deletion; a deleted section is an ordinary hunk that review
 * skims past, so the section -- not just the file -- is what this pins.
 *
 * Headings are matched as whole lines ("## Installation"), never as
 * substrings. Ported from the pipeline template's check-required-docs.sh as
 * Node, so it also runs on the Windows test leg.
 *
 * Usage:
 *   node scripts/check-required-docs.mjs          # run the check
 *   node scripts/check-required-docs.mjs --list   # print path<TAB>section
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// To require more, add both the file and the sections its readers depend on.
export const REQUIREMENTS = [
  {
    path: 'README.md',
    sections: [
      'Installation',
      'Configuration',
      'CLI Usage',
      'Library Usage',
      'Contributing',
      'License',
    ],
  },
  // The release preflight annotation links here for the npm owner steps.
  { path: 'docs/npm-publishing.md', sections: ['Owner procedure'] },
  { path: 'CHANGELOG.md', sections: [] },
];

export function hasHeading(content, section) {
  return content.replaceAll('\r\n', '\n').split('\n').includes(`## ${section}`);
}

export function findDocViolations(requirements, { exists, read }) {
  const violations = [];
  for (const { path: file, sections } of requirements) {
    if (!exists(file)) {
      violations.push({
        file,
        message:
          'Required document is missing. Restore it or update scripts/check-required-docs.mjs.',
      });
      continue;
    }
    const content = read(file);
    for (const section of sections) {
      if (!hasHeading(content, section)) {
        violations.push({
          file,
          message: `Required section '## ${section}' is missing. Restore the section or update scripts/check-required-docs.mjs.`,
        });
      }
    }
  }
  return violations;
}

function main(argv) {
  if (argv.includes('--list')) {
    for (const { path: file, sections } of REQUIREMENTS) {
      if (sections.length === 0) {
        console.log(file);
      }
      for (const section of sections) {
        console.log(`${file}\t${section}`);
      }
    }
    return 0;
  }
  const violations = findDocViolations(REQUIREMENTS, {
    exists: existsSync,
    read: (file) => readFileSync(file, 'utf8'),
  });
  for (const { file, message } of violations) {
    console.log(`::error file=${file}::${message}`);
  }
  if (violations.length > 0) {
    console.error(
      `${violations.length} documentation requirement(s) violated.`
    );
    return 1;
  }
  console.log(
    `All documentation requirements satisfied (${REQUIREMENTS.length} documents checked).`
  );
  return 0;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main(process.argv.slice(2));
}

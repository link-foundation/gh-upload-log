import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assert, test } from 'test-anywhere';
import {
  buildNpmVersionBadge,
  buildReleaseDescription,
  formatRelatedPullRequests,
} from '../scripts/format-release-notes-helpers.mjs';

// Template issues #236 and #242: the old cleanup trimmed every line, cut
// everything after `---` (and every later entry), rewrote `\n` and quotes,
// and linked one PR. The v0.9.0 release of this package lost its nested
// list that way (dev/log/issues/59/pulls/60/releases/).

const projectRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

const entry = [
  '- 68f606a: First change.',
  '',
  '  Second paragraph.',
  '',
  '  - nested',
  '    continued',
  '',
  '  ---',
  '',
  '  After a rule, with `\\n` and a "quote"',
];

test('a single changeset keeps its paragraphs, nested lists and rules', () => {
  const body = ['### Patch Changes', '', ...entry, ''].join('\n');
  assert.deepEqual(buildReleaseDescription(body), {
    description: [
      'First change.',
      '',
      'Second paragraph.',
      '',
      '- nested',
      '  continued',
      '',
      '---',
      '',
      'After a rule, with `\\n` and a "quote"',
    ].join('\n'),
    commitHashes: ['68f606a'],
  });
});

test('every changeset entry is kept and every hash is returned', () => {
  const body = [
    '### Patch Changes',
    '',
    ...entry,
    '- def5678: Second entry',
    '- Entry without a hash',
  ].join('\n');
  const release = buildReleaseDescription(body);
  assert.equal(release.description, body.split('\n').slice(2).join('\n'));
  assert.deepEqual(release.commitHashes, ['68f606a', 'def5678']);
});

test('several sections keep their headings; CRLF and duplicates are normalized', () => {
  const body = [
    '## 1.2.0',
    '',
    '### Minor Changes',
    '',
    '- abc1234: Feature   ',
    '',
    '### Patch Changes',
    '',
    '- def5678: Fix',
    '- abc1234: Same commit',
    '',
  ].join('\r\n');
  assert.deepEqual(buildReleaseDescription(body), {
    description: [
      '### Minor Changes',
      '',
      '- abc1234: Feature',
      '',
      '### Patch Changes',
      '',
      '- def5678: Fix',
      '- abc1234: Same commit',
    ].join('\n'),
    commitHashes: ['abc1234', 'def5678'],
  });
});

test('a body without a changes section is left alone', () => {
  assert.equal(buildReleaseDescription('Just text\n\n## Notes'), null);
});

test('one related PR is singular, several are listed', () => {
  assert.equal(formatRelatedPullRequests([]), '');
  assert.equal(
    formatRelatedPullRequests([41]),
    '**Related Pull Request:** #41'
  );
  assert.equal(
    formatRelatedPullRequests([41, 42]),
    '**Related Pull Requests:** #41, #42'
  );
});

// Unescaped, `gh-upload-log-1.0.0-rc_1` reads as label "gh", message
// "upload" and shields.io answers "404: badge not found".
test('npm badges escape the dashes and underscores shields.io splits on', () => {
  assert.equal(
    buildNpmVersionBadge('gh-upload-log', 'v1.0.0-rc_1'),
    '[![gh-upload-log npm version](https://img.shields.io/badge/gh--upload--log-1.0.0--rc__1-blue.svg)](https://www.npmjs.com/package/gh-upload-log/v/1.0.0-rc_1)'
  );
});

test('format-release-notes publishes every entry and links every PR', () => {
  const fakeBin = fs.mkdtempSync(
    path.join(os.tmpdir(), 'gh-upload-log-release-notes-')
  );
  const fakeGhScript = path.join(fakeBin, 'fake-gh.mjs');
  const fakeGh = path.join(fakeBin, 'gh');
  const fakeGhCommand = process.platform === 'win32' ? `${fakeGh}.cmd` : fakeGh;
  const payloadCopy = path.join(fakeBin, 'payload.json');
  const body = [
    '### Patch Changes',
    '',
    ...entry,
    '- def5678: Second entry',
    '',
  ].join('\n');

  try {
    fs.writeFileSync(
      fakeGhScript,
      [
        "import { copyFileSync } from 'node:fs';",
        'const args = process.argv.slice(2);',
        "const input = args.indexOf('--input');",
        'if (input !== -1) {',
        `  copyFileSync(args[input + 1].replace(/^"|"$/g, ''), ${JSON.stringify(payloadCopy)});`,
        '  process.exit(0);',
        '}',
        "const commit = args.join(' ').match(/commits\\/(\\w+)\\/pulls/);",
        'if (commit) {',
        "  const number = { '68f606a': 41, def5678: 42 }[commit[1]];",
        "  console.log(JSON.stringify([{ number, title: 'fix' }]));",
        '  process.exit(0);',
        '}',
        `console.log(JSON.stringify({ body: ${JSON.stringify(body)} }));`,
        '',
      ].join('\n')
    );
    fs.writeFileSync(
      fakeGh,
      `#!${process.execPath}\nimport './fake-gh.mjs';\n`,
      { mode: 0o755 }
    );
    fs.writeFileSync(
      `${fakeGh}.cmd`,
      `@echo off\r\n"${process.execPath}" "%~dp0\\fake-gh.mjs" %*\r\n`
    );

    const result = spawnSync(
      process.execPath,
      [
        path.join(projectRoot, 'scripts', 'format-release-notes.mjs'),
        '--release-id',
        '123',
        '--release-version',
        'v9.9.9',
        '--repository',
        'owner/repository',
        '--gh-command',
        fakeGhCommand,
      ],
      { cwd: projectRoot, encoding: 'utf8' }
    );
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    assert.equal(result.status, 0, output);

    const published = JSON.parse(fs.readFileSync(payloadCopy, 'utf8')).body;
    const [notes] = published.split('\n\n**Related Pull Requests:**');
    assert.equal(notes, body.trimEnd().split('\n').slice(2).join('\n'));
    assert.ok(
      published.includes('**Related Pull Requests:** #41, #42\n\n---\n\n'),
      published
    );
    assert.ok(
      published.includes('img.shields.io/badge/gh--upload--log-9.9.9-blue.svg'),
      published
    );
  } finally {
    fs.rmSync(fakeBin, { recursive: true, force: true });
  }
}, 30000);

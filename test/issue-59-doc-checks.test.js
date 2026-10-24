import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, test } from 'test-anywhere';
import {
  countLines,
  findViolations,
  limitFor,
} from '../scripts/check-file-size.mjs';
import {
  REQUIREMENTS,
  findDocViolations,
  hasHeading,
} from '../scripts/check-required-docs.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('file-size limits cover JavaScript, Markdown and workflow YAML', () => {
  assert.equal(limitFor('src/index.js'), 1000);
  assert.equal(limitFor('scripts/check-file-size.mjs'), 1000);
  assert.equal(limitFor('README.md'), 1500);
  assert.equal(limitFor('.github/workflows/release.yml'), 1500);
  assert.equal(limitFor('docs/case-studies/issue-1/README.md'), null);
  assert.equal(limitFor('dev/log/issues/59/pulls/60/run.log'), null);
  assert.equal(limitFor('package.json'), null);
});

test('file-size check reports each oversized file with its limit', () => {
  const contents = {
    'big.js': 'x\n'.repeat(1000),
    'ok.js': 'x\n'.repeat(999),
    'big.md': 'x\n'.repeat(1500),
    'ok.yml': 'x\n'.repeat(1499),
  };
  const { checked, violations } = findViolations(
    Object.keys(contents),
    (file) => contents[file]
  );
  assert.equal(checked.length, 4);
  assert.deepEqual(
    violations.map(({ file, lines, maxLines }) => [file, lines, maxLines]),
    [
      ['big.js', 1001, 1000],
      ['big.md', 1501, 1500],
    ]
  );
  assert.equal(countLines('a\nb'), 2);
});

test('ESLint max-lines matches the CI JavaScript file-size limit', () => {
  const config = fs.readFileSync(path.join(root, 'eslint.config.js'), 'utf8');
  assert.ok(/'max-lines':\s*\[\s*'error',\s*\{\s*max: 1000\b/.test(config));
});

test('required docs match whole heading lines only', () => {
  assert.equal(hasHeading('# T\r\n## License\r\n', 'License'), true);
  assert.equal(hasHeading('## Licensed under MIT\n', 'License'), false);
  assert.equal(hasHeading('### License\n', 'License'), false);
});

test('required docs check names missing files and missing sections', () => {
  const files = { 'README.md': '## Installation\n' };
  const violations = findDocViolations(
    [
      { path: 'README.md', sections: ['Installation', 'License'] },
      { path: 'CHANGELOG.md', sections: [] },
    ],
    { exists: (file) => file in files, read: (file) => files[file] }
  );
  assert.deepEqual(
    violations.map(({ file }) => file),
    ['README.md', 'CHANGELOG.md']
  );
  assert.ok(violations[0].message.includes("'## License'"));
  assert.ok(violations[1].message.includes('missing'));
});

test('the repository satisfies its documentation requirements', () => {
  const violations = findDocViolations(REQUIREMENTS, {
    exists: (file) => fs.existsSync(path.join(root, file)),
    read: (file) => fs.readFileSync(path.join(root, file), 'utf8'),
  });
  assert.deepEqual(violations, []);
});

test('doc and size checks run in the check script and the CI lint job', () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8')
  );
  assert.ok(pkg.scripts.check.includes('bun run check:file-size'));
  assert.ok(pkg.scripts.check.includes('bun run check:docs'));
  const release = fs.readFileSync(
    path.join(root, '.github/workflows/release.yml'),
    'utf8'
  );
  assert.ok(release.includes('run: bun run check:file-size'));
  assert.ok(release.includes('run: bun run check:docs'));
});

test('check-required-docs --list prints path and section pairs', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/check-required-docs.mjs', '--list'],
    { cwd: root, encoding: 'utf8' }
  );
  assert.equal(result.status, 0);
  const lines = result.stdout.replaceAll('\r\n', '\n').trim().split('\n');
  assert.ok(lines.includes('README.md\tLicense'));
  assert.ok(lines.includes('CHANGELOG.md'));
});

test('the local test script uses the same per-test timeout as CI', () => {
  // Bun ignores `[test] timeout` in bunfig.toml (see
  // experiments/issue-59-bunfig-test-timeout.sh), so the flag must be in the
  // script; without it local runs time out at 5s where CI allows 30s.
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8')
  );
  const release = fs.readFileSync(
    path.join(root, '.github/workflows/release.yml'),
    'utf8'
  );
  const ciTimeout = release.match(/bun test --timeout (\d+)/)?.[1];
  assert.ok(ciTimeout);
  assert.equal(pkg.scripts.test, `bun test --timeout ${ciTimeout}`);
});

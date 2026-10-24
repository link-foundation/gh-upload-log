import { assert, test } from 'test-anywhere';
import {
  classifyChanges,
  getChangedFiles,
} from '../scripts/detect-code-changes.mjs';
import { checkVersionChange } from '../scripts/check-version.mjs';

test('placeholder and log-only changes are not code changes', () => {
  const result = classifyChanges([
    'dev/log/issues/59/pulls/60/README.md',
    'dev/log/issues/59/pulls/60/ci-logs/run.log',
    'experiments/.gitkeep',
    'some/dir/.gitkeep',
    '.changeset/fix.md',
  ]);
  assert.equal(result['any-code-changed'], false);
  assert.equal(result['docs-changed'], false);
});

test('documentation-only changes skip code checks but are reported', () => {
  const result = classifyChanges(['README.md', 'docs/npm-publishing.md']);
  assert.equal(result['any-code-changed'], false);
  assert.equal(result['docs-changed'], true);
});

test('unknown file types count as code so tests can never be skipped', () => {
  const result = classifyChanges(['bun.lock', '.github/workflows/release.yml']);
  assert.equal(result['any-code-changed'], true);
  assert.equal(result['js-changed'], false);
  assert.deepEqual(result.codeFiles, [
    'bun.lock',
    '.github/workflows/release.yml',
  ]);
  assert.equal(classifyChanges(['src/cli.js'])['js-changed'], true);
});

test('pull requests diff the whole PR and fall back when HEAD^2 is missing', () => {
  const calls = [];
  const files = getChangedFiles(
    { GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_SHA: 'base' },
    (args) => {
      calls.push(args.join(' '));
      if (args.includes('HEAD^2')) {
        throw new Error('unknown revision');
      }
      return 'src/cli.js\nREADME.md';
    }
  );
  assert.deepEqual(calls, [
    'diff --name-only base HEAD^2',
    'diff --name-only base HEAD',
  ]);
  assert.deepEqual(files, ['src/cli.js', 'README.md']);
});

test('pushes ignore the all-zero before SHA of a new branch', () => {
  const calls = [];
  getChangedFiles(
    { GITHUB_EVENT_NAME: 'push', GITHUB_BEFORE_SHA: '0'.repeat(40) },
    (args) => {
      calls.push(args.join(' '));
      return '';
    }
  );
  assert.deepEqual(calls, ['diff --name-only HEAD^1 HEAD']);
});

test('manual version edits fail except on the changeset release branch', () => {
  assert.equal(
    checkVersionChange({ baseVersion: '1.0.0', headVersion: '1.0.0' }),
    null
  );
  assert.match(
    checkVersionChange({ baseVersion: '1.0.0', headVersion: '1.0.1' }),
    /1\.0\.0 to 1\.0\.1.*changeset/
  );
  assert.equal(
    checkVersionChange({
      baseVersion: '1.0.0',
      headVersion: '1.1.0',
      headRef: 'changeset-release/main',
    }),
    null
  );
});

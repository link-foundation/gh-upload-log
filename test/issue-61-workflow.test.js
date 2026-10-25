import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'test-anywhere';

const workflow = readFileSync(
  new URL('../.github/workflows/release.yml', import.meta.url),
  'utf8'
).replaceAll('\r\n', '\n');

test('both release jobs reconcile before installs or changeset consumption', () => {
  for (const name of ['release', 'instant-release']) {
    const job = workflow.split(`\n  ${name}:\n`)[1].split(/\n {2}[\w-]+:\n/)[0];
    const prepare = job.indexOf('node scripts/prepare-release-checkout.mjs');
    assert.ok(prepare !== -1, `${name}: missing checkout reconciliation`);
    assert.ok(prepare < job.indexOf('- name: Install dependencies'));
    assert.ok(prepare < job.indexOf('- name: Version packages'));
    assert.ok(
      !job.includes('scripts/merge-changesets.mjs'),
      'merging belongs inside reconciled versioning'
    );
    assert.ok(
      !job.includes('--should-pull'),
      'publication must retain the selected version commit'
    );
    assert.match(
      job,
      /run-with-budget-warning.sh" 3300 "npm package smoke test"/
    );
    assert.match(job, /timeout-minutes: 90/);
    assert.match(job, /steps\.prepare\.outputs\.recovered_version/);
    assert.match(job, /--target-commit/);
    assert.ok(!job.includes('COMMIT_SHA: ${{ github.sha }}'));
  }
});

test('historical runs can use the current workflow without requesting a bump', () => {
  assert.match(workflow, /options:[\s\S]*- recover\n/);
  assert.match(workflow, /recovery_sha:\n[\s\S]*default: ''/);
  assert.match(
    workflow,
    /RELEASE_SOURCE_SHA: .*github\.event\.inputs\.recovery_sha/
  );
  assert.match(
    workflow,
    /RECOVERY_ONLY: .*github\.event_name == 'workflow_dispatch'/
  );
  const release = workflow
    .split('\n  release:\n')[1]
    .split('\n  instant-release:\n')[0];
  assert.match(release, /github\.event\.inputs\.release_mode == 'recover'/);
  for (const gate of [
    'needs.lint.result',
    'needs.test.result',
    'needs.release-preflight.result',
  ]) {
    assert.ok(release.includes(`${gate} == 'success'`));
  }
});

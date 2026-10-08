import { testWithTimeout as test } from '../experiments/real-git-test-utils.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';

test('issue #37 - release changeset validation and merging follow the renamed manifest', () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'issue-37-changeset-')
  );
  const changesets = path.join(directory, '.changeset');
  fs.mkdirSync(changesets);
  fs.writeFileSync(
    path.join(directory, 'package.json'),
    '{"name":"gh-upload"}\n'
  );
  fs.writeFileSync(
    path.join(changesets, 'feature.md'),
    "---\n'gh-upload': minor\n---\n\nUniversal file uploads.\n"
  );
  const env = { ...process.env };
  for (const name of [
    'GITHUB_BASE_SHA',
    'GITHUB_HEAD_SHA',
    'BASE_SHA',
    'HEAD_SHA',
    'GITHUB_BASE_REF',
  ]) {
    delete env[name];
  }
  function run(script) {
    const source = fileURLToPath(
      new URL(`../scripts/${script}`, import.meta.url)
    );
    return spawnSync('node', [source], {
      cwd: directory,
      env,
      encoding: 'utf8',
      timeout: 10_000,
    });
  }
  try {
    let result = run('validate-changeset.mjs');
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    fs.writeFileSync(
      path.join(changesets, 'fix.md'),
      "---\n'gh-upload': patch\n---\n\nPreserve old package releases.\n"
    );
    result = run('merge-changesets.mjs');
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    const files = fs.readdirSync(changesets);
    assert.equal(files.length, 1);
    const merged = fs.readFileSync(path.join(changesets, files[0]), 'utf8');
    assert.match(merged, /'gh-upload': minor/);
    assert.match(merged, /Universal file uploads/);
    assert.match(merged, /Preserve old package releases/);
    result = run('validate-changeset.mjs');
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

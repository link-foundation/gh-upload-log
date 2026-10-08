// Verify actual command-stream interpolation for isolated Git authentication.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { $ } from 'command-stream';
import { ensureCommandSucceeded } from '../src/common.js';

const directory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'issue47-command-stream-')
);
try {
  const git = $({ cwd: directory, mirror: false, capture: true });
  ensureCommandSucceeded(
    await git`git -c init.defaultBranch=main init -q`,
    'initialize probe'
  );
  const key = 'credential.https://github.com.helper';
  const reset = '';
  const helper = '!gh auth git-credential';
  ensureCommandSucceeded(
    await git`git config --local --add ${key} ${reset}`,
    'reset inherited helper'
  );
  ensureCommandSucceeded(
    await git`git config --local --add ${key} ${helper}`,
    'set token authentication'
  );
  const result = ensureCommandSucceeded(
    await git`git config --local --get-all ${key}`,
    'read local helpers'
  );
  assert.equal(result.stdout.trim(), helper);
  console.log(
    'Empty helper reset and gh credential helper survive command-stream interpolation.'
  );
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

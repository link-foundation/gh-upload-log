#!/usr/bin/env bun
/**
 * Experiment for issue #38: verify that a gist larger than the current 25MB
 * threshold really stores the full file (no truncation) and that its raw URL
 * serves byte-identical content.
 *
 * Creates a throwaway secret gist, downloads it back, compares SHA-256, and
 * deletes the gist afterwards.
 *
 * Usage: bun experiments/gist-content-integrity.mjs [sizeMB]
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sizeMB = Number(process.argv[2] || 31);
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gist-integrity-'));
const filePath = path.join(workDir, `integrity-${sizeMB}mb.log.txt`);

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  });
  return {
    code: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const chunk = Buffer.from(`${'y'.repeat(99)}\n`.repeat(10_000));
const handle = fs.openSync(filePath, 'w');
let written = 0;
while (written < sizeMB * 1024 * 1024) {
  fs.writeSync(handle, chunk);
  written += chunk.length;
}
fs.closeSync(handle);

const localHash = sha256(filePath);
const localSize = fs.statSync(filePath).size;
const report = { sizeMB, localSize, localHash };

try {
  const created = run('gh', [
    'gist',
    'create',
    filePath,
    '--desc',
    `gh-upload-log issue #38 gist integrity probe (${sizeMB}MB)`,
  ]);
  report.createExitCode = created.code;
  report.url =
    created.stdout
      .split('\n')
      .find((line) => line.startsWith('https://gist.github.com/')) || null;
  report.createStderr = created.stderr.slice(0, 1000);

  if (report.url) {
    const gistId = report.url.split('/').pop();
    const details = run('gh', [
      'api',
      `gists/${gistId}`,
      '--jq',
      '.files | to_entries | map({filename: .key, size: .value.size, truncated: .value.truncated, raw_url: .value.raw_url})',
    ]);
    report.apiFiles = details.code === 0 ? JSON.parse(details.stdout) : null;
    report.apiStderr = details.stderr.slice(0, 1000);

    const rawUrl = report.apiFiles?.[0]?.raw_url;
    if (rawUrl) {
      const downloaded = path.join(workDir, 'downloaded.log.txt');
      const curl = run('curl', ['-sSL', '-o', downloaded, rawUrl]);
      report.downloadExitCode = curl.code;
      if (fs.existsSync(downloaded)) {
        report.downloadedSize = fs.statSync(downloaded).size;
        report.downloadedHash = sha256(downloaded);
        report.identical = report.downloadedHash === localHash;
      }
    }

    const deleted = run('gh', ['gist', 'delete', gistId, '--yes']);
    report.deleted = deleted.code === 0;
  }
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
}

console.log(JSON.stringify(report, null, 2));

const outputPath = path.join(
  process.cwd(),
  'docs',
  'case-studies',
  'issue-38',
  `gist-content-integrity-${sizeMB}mb.json`
);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nSaved results to ${outputPath}`);

#!/usr/bin/env bun
/**
 * Experiment for issue #38: "double check if gist really does not allow files with that size".
 *
 * Creates throwaway secret gists of increasing size with the authenticated
 * `gh` account, records the API response, and deletes every gist it created.
 *
 * Usage: bun experiments/gist-size-limit-probe.mjs [sizeMB ...]
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sizesMB = process.argv.slice(2).map(Number);
const sizes = sizesMB.length ? sizesMB : [1, 10, 25, 26, 31, 50, 100, 110];

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gist-size-probe-'));
const results = [];

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

function writeFileOfSize(filePath, sizeBytes) {
  const line = `${'x'.repeat(99)}\n`;
  const chunk = Buffer.from(line.repeat(10_000)); // ~1MB
  const handle = fs.openSync(filePath, 'w');
  let written = 0;
  while (written < sizeBytes) {
    const slice =
      chunk.length <= sizeBytes - written
        ? chunk
        : chunk.subarray(0, sizeBytes - written);
    fs.writeSync(handle, slice);
    written += slice.length;
  }
  fs.closeSync(handle);
}

try {
  for (const sizeMB of sizes) {
    const filePath = path.join(workDir, `probe-${sizeMB}mb.log.txt`);
    writeFileOfSize(filePath, sizeMB * 1024 * 1024);
    const startedAt = Date.now();
    const created = run('gh', [
      'gist',
      'create',
      filePath,
      '--desc',
      `gh-upload-log issue #38 gist size probe (${sizeMB}MB)`,
    ]);
    const durationMs = Date.now() - startedAt;
    const url =
      created.stdout
        .split('\n')
        .find((line) => line.startsWith('https://gist.github.com/')) || null;
    const entry = {
      sizeMB,
      sizeBytes: sizeMB * 1024 * 1024,
      exitCode: created.code,
      durationMs,
      url,
      stderr: created.stderr.slice(0, 2000),
      deleted: false,
    };

    if (url) {
      const gistId = url.split('/').pop();
      const deleted = run('gh', ['gist', 'delete', gistId, '--yes']);
      entry.deleted = deleted.code === 0;
      entry.deleteStderr = deleted.stderr.slice(0, 500);
    }

    results.push(entry);
    console.log(JSON.stringify(entry));
    fs.rmSync(filePath, { force: true });
  }
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
}

const outputPath = path.join(
  process.cwd(),
  'docs',
  'case-studies',
  'issue-38',
  'gist-size-limit-probe.json'
);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(results, null, 2)}\n`);
console.log(`\nSaved results to ${outputPath}`);

#!/usr/bin/env bun

/**
 * Example: a log that keeps growing is uploaded again
 *
 * Real-world case from issue #38: a bot writes to `hive-telegram-bot.log`, and
 * the log is uploaded after every run. The path never changes, but the content
 * does — and every version must stay reachable.
 *
 * Repository-mode uploads are content addressed:
 *
 *   <normalized-directory>/<content-hash>/<file-name>.log.txt
 *
 * so a changed file lands in a new folder, while re-uploading identical bytes
 * reuses what is already there.
 *
 * This example runs in dry mode, so it makes no network calls.
 *
 * Usage: bun examples/changed-file-reupload.js
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { uploadLog, generateFileContentHash } from '../src/index.js';

const logFile = path.join(os.tmpdir(), 'gh-upload-log-example-service.log');

async function showUpload(label) {
  const result = await uploadLog({
    filePath: logFile,
    onlyRepository: true,
    dryMode: true,
  });

  console.log(`${label}:`);
  console.log(`  content hash: ${await generateFileContentHash(logFile)}`);
  console.log(`  repository:   ${result.repositoryName}`);
  console.log(`  path:         ${result.repositoryPath}`);
  console.log(`  file name:    ${result.fileName}`);
  console.log('');

  return result.repositoryPath;
}

fs.writeFileSync(logFile, '[12:00:00] service started\n');
const firstPath = await showUpload('First upload');

// Same bytes again — the existing file is reused instead of pushing a duplicate.
const unchangedPath = await showUpload('Re-upload without changes');

// The service keeps logging, exactly like the 30.98MB → 31.02MB case in issue #38.
fs.appendFileSync(logFile, '[12:00:05] request handled\n');
const changedPath = await showUpload('Upload after the log changed');

console.log(
  `Unchanged content keeps the same path: ${unchangedPath === firstPath}`
);
console.log(
  `Changed content gets a new path:      ${changedPath !== firstPath}`
);

fs.unlinkSync(logFile);

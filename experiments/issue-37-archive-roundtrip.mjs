// Finite large-file probe. Run with: node --max-old-space-size=192 experiments/issue-37-archive-roundtrip.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { stageUploadFiles } from '../src/file-upload.js';
import { GITHUB_REPO_CHUNK_SIZE } from '../src/index.js';

const inputSize = GITHUB_REPO_CHUNK_SIZE + 64 * 1024;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-37-large-'));
const filePath = path.join(directory, 'random.bin');
try {
  const originalHash = createHash('sha256');
  async function* source() {
    for (let offset = 0; offset < inputSize; offset += 64 * 1024) {
      const bytes = randomBytes(Math.min(64 * 1024, inputSize - offset));
      originalHash.update(bytes);
      yield bytes;
    }
  }
  await pipeline(Readable.from(source()), fs.createWriteStream(filePath));
  const partsDir = path.join(directory, 'parts');
  const parts = await stageUploadFiles(
    filePath,
    partsDir,
    GITHUB_REPO_CHUNK_SIZE
  );
  assert.equal(parts.length, 2);
  const sizes = parts.map(
    (name) => fs.statSync(path.join(partsDir, name)).size
  );
  assert.ok(sizes.every((size) => size <= GITHUB_REPO_CHUNK_SIZE));
  const recoveredHash = createHash('sha256');
  let recoveredSize = 0;
  async function* archives() {
    for (const name of parts.slice().sort()) {
      yield* fs.createReadStream(path.join(partsDir, name));
    }
  }
  await pipeline(
    Readable.from(archives()),
    createGunzip(),
    new Writable({
      write(bytes, _encoding, callback) {
        recoveredHash.update(bytes);
        recoveredSize += bytes.length;
        callback();
      },
    })
  );
  assert.equal(recoveredSize, inputSize);
  const sha256 = originalHash.digest('hex');
  assert.equal(recoveredHash.digest('hex'), sha256);
  console.log(
    JSON.stringify(
      {
        inputSize,
        partSizes: sizes,
        recoveredSize,
        sha256,
        peakRssBytes: process.resourceUsage().maxRSS * 1024,
      },
      null,
      2
    )
  );
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

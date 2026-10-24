// Finite reproduction of issue #55's real log sizes and 15 MiB records.
// Run with: node --max-old-space-size=640 experiments/issue-55-streaming.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { withSanitizedUpload } from '../src/sanitization.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sanitization-probe-'));
const secret = 'finite-probe-private-value';
try {
  for (const sizeMiB of process.argv.includes('--quick') ? [17] : [17, 87]) {
    const filePath = path.join(directory, `${sizeMiB}.log`);
    const descriptor = fs.openSync(filePath, 'w');
    const line = Buffer.alloc(15 * 1024 * 1024, 'A');
    const record = Buffer.from(
      `\npassword=${secret}\r\nAccount github.com/konard user@example.org\n`
    );
    const rest = Buffer.from(
      'Ordinary log text remains byte for byte.\n'.repeat(1024)
    );
    const hash = createHash('sha256');
    try {
      fs.writeSync(descriptor, line);
      hash.update(line);
      fs.writeSync(descriptor, record);
      hash.update(record.toString().replace(secret, '[REDACTED]'));
      let written = line.length + record.length;
      while (written < sizeMiB * 1024 * 1024) {
        const chunk = rest.subarray(
          0,
          Math.min(rest.length, sizeMiB * 1024 * 1024 - written)
        );
        fs.writeSync(descriptor, chunk);
        hash.update(chunk);
        written += chunk.length;
      }
    } finally {
      fs.closeSync(descriptor);
    }
    const expected = hash.digest('hex');
    const start = performance.now();
    const result = await withSanitizedUpload({ filePath }, async (options) => {
      const safeHash = createHash('sha256');
      for await (const chunk of fs.createReadStream(options.filePath)) {
        safeHash.update(chunk);
      }
      assert.equal(safeHash.digest('hex'), expected);
      return {};
    });
    assert.equal(result.sanitization.redactions, 1);
    console.log(
      JSON.stringify({
        sizeMiB,
        durationMs: Math.round(performance.now() - start),
        ...result.sanitization,
        rssMiB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      })
    );
    fs.unlinkSync(filePath);
  }
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

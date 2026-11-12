// Issue 65: cost of the extra line scan that chooses segment cuts.
// Usage: bun experiments/issue-65-scan-cost.mjs [megabytes]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { segmentCuts } from '../src/sanitization-segments.js';

const mb = Number(process.argv[2] || 50);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-65-scan-'));
const file = path.join(dir, 'big.log');
try {
  const block = Array.from(
    { length: 10000 },
    (_, i) =>
      `2026-11-12T00:00:00.000Z INFO ordinary log line ${i} padding text\n`
  ).join('');
  const fd = fs.openSync(file, 'w');
  fs.writeSync(fd, 'default = ["macro"]\n');
  for (let size = 0; size < mb * 1024 * 1024; size += block.length) {
    fs.writeSync(fd, block);
  }
  fs.closeSync(fd);
  const handle = await fs.promises.open(file);
  const size = (await handle.stat()).size;
  const t = performance.now();
  const cuts = await segmentCuts(handle, size);
  await handle.close();
  console.log(
    `${(size / 1048576).toFixed(0)} MiB scanned in ${(performance.now() - t).toFixed(0)} ms, ${cuts.length} cuts`
  );
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Sanitize one synthetic JSON record of N MiB with the record bound raised to
// the file size; prints elapsed time and peak RSS sampled every 200 ms.
// bun experiments/issue-63-huge-record.mjs <MiB> <workdir>
import fs from 'node:fs';
import path from 'node:path';
import { setInterval, clearInterval } from 'node:timers';
import { sanitizeFileToFile } from '@link-foundation/sensitive-data-sanitizer';
const mib = Number(process.argv[2] || 100);
const dir = process.argv[3] || '/tmp/i63-huge';
fs.mkdirSync(dir, { recursive: true });
const input = path.join(dir, 'in.log');
const fd = fs.openSync(input, 'w');
fs.writeSync(fd, '{"type":"item","text":"');
const block = 'tool output line\\n '.repeat((1024 * 1024) / 20);
for (let written = 0; written < mib * 1024 * 1024; written += block.length) {
  fs.writeSync(fd, block);
}
fs.writeSync(fd, '"}\n');
fs.closeSync(fd);
let peak = 0;
const timer = setInterval(() => {
  peak = Math.max(peak, process.memoryUsage().rss);
}, 200);
const size = fs.statSync(input).size;
const started = Date.now();
try {
  await sanitizeFileToFile(input, path.join(dir, 'out.log'), {
    allowBinary: true,
    maxRecordBytes: size,
    maxTotalBytes: size,
    sanitizerOptions: { credentialsOnly: true },
    replace: true,
  });
  console.log(`${mib} MiB record: ok in ${Date.now() - started} ms`);
} catch (error) {
  console.log(
    `${mib} MiB record: ${error.code} ${error.message} in ${Date.now() - started} ms`
  );
} finally {
  clearInterval(timer);
  console.log(`peak rss ${Math.round(peak / 1048576)} MiB`);
  fs.rmSync(dir, { recursive: true, force: true });
}

// Issue 65: a `default = [...]` line makes sensitive-data-sanitizer's stream
// boundary scan quadratic. Compares plain logs with logs that start with the
// trigger line, through sanitizeFileToFile and through withSanitizedUpload.
// Usage: bun experiments/issue-65-netrc-bench.mjs [maxLines]
import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sanitizeFileToFile } from '@link-foundation/sensitive-data-sanitizer';
import { withSanitizedUpload } from '../src/sanitization.js';

const max = Number(process.argv[2] || 16000);
const line = (i) =>
  `2026-11-12T00:00:00.000Z INFO ordinary log line ${i} some text here and more text to pad the line\n`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-65-'));
try {
  for (let n = 1000; n <= max; n *= 2) {
    for (const trigger of [false, true]) {
      const file = path.join(dir, `${trigger}-${n}.log`);
      fs.writeFileSync(
        file,
        (trigger ? 'default = ["macro"]\n' : '') +
          Array.from({ length: n }, (_, i) => line(i)).join('')
      );
      let t = performance.now();
      await sanitizeFileToFile(file, `${file}.out`);
      const library = performance.now() - t;
      t = performance.now();
      await withSanitizedUpload({ filePath: file }, () => ({}));
      const upload = performance.now() - t;
      console.log(
        `${trigger ? 'netrc' : 'plain'} n=${n} sanitizeFileToFile=${library.toFixed(0)}ms withSanitizedUpload=${upload.toFixed(0)}ms`
      );
    }
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Time withSanitizedUpload on one 65 MiB record of various fillers.
// bun experiments/issue-63-record-content.mjs <filler>...
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withSanitizedUpload } from '../src/sanitization.js';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'i63-record-'));
try {
  for (const filler of process.argv.slice(2)) {
    const file = path.join(dir, 'record.log');
    fs.writeFileSync(
      file,
      `${filler.repeat((65 * 1024 * 1024) / filler.length)}\n`
    );
    const started = Date.now();
    const result = await withSanitizedUpload({ filePath: file }, () => ({}));
    console.log(
      JSON.stringify(filler),
      Date.now() - started,
      'ms',
      result.sanitization.inputBytes
    );
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

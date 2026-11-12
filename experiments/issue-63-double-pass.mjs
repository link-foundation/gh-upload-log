// Compare sanitizeFileToFile with a counting callback (engine runs twice:
// callback + residual verification) and without (engine runs once).
// bun experiments/issue-63-double-pass.mjs [lines]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createSanitizer,
  sanitizeFileToFile,
} from '@link-foundation/sensitive-data-sanitizer';
const lines = Number(process.argv[2] || 50000);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'i63-'));
const input = path.join(dir, 'in.log');
fs.writeFileSync(
  input,
  `${Array.from(
    { length: lines },
    (_, i) => `line ${i} token ghp…b4N and Bearer 012…567`
  ).join('\n')}\n`
);
const sanitizerOptions = { credentialsOnly: true };
const base = {
  allowBinary: true,
  maxTotalBytes: fs.statSync(input).size,
  sanitizerOptions,
};
let t = Date.now();
await sanitizeFileToFile(input, path.join(dir, 'a.log'), base);
console.log(`single pass: ${Date.now() - t} ms`);
const engine = createSanitizer(sanitizerOptions);
t = Date.now();
await sanitizeFileToFile(input, path.join(dir, 'b.log'), {
  ...base,
  sanitizer: { sanitize: (text) => engine.sanitize(text) },
});
console.log(`callback + verification: ${Date.now() - t} ms`);
t = Date.now();
await sanitizeFileToFile(input, path.join(dir, 'c.log'), {
  ...base,
  sanitizer: engine,
});
console.log(`configured engine passed as sanitizer: ${Date.now() - t} ms`);
fs.rmSync(dir, { recursive: true, force: true });

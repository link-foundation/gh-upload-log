// bun experiments/issue-63-repro.mjs <gh-upload-log dir> <work dir> [case...]
// Runs only withSanitizedUpload with a no-op upload; nothing is published.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [packageDir, workDir, ...only] = process.argv.slice(2);
const { withSanitizedUpload } = await import(
  pathToFileURL(path.join(packageDir, 'src', 'sanitization.js')).href
);
const base64Line = (i) =>
  Buffer.from(`synthetic payload ${i} `.repeat(4)).toString('base64');
const cases = {
  'base64-lines-4000': () =>
    `${Array.from({ length: 4000 }, (_, i) => base64Line(i)).join('\n')}\n`,
  'base64-lines-4200': () =>
    `${Array.from({ length: 4200 }, (_, i) => base64Line(i)).join('\n')}\n`,
  'base64-lines-5000': () =>
    `${Array.from({ length: 5000 }, (_, i) => base64Line(i)).join('\n')}\n`,
  'line-over-64mib': () =>
    `{"type":"item","text":"${'a '.repeat(33 * 1024 * 1024)}"}\n`,
  'masks-200000': () =>
    `${Array.from(
      { length: 200000 },
      (_, i) => `line ${i} token ghp…b4N and Bearer 012…567`
    ).join('\n')}\n`,
};
fs.mkdirSync(workDir, { recursive: true });
for (const [name, make] of Object.entries(cases)) {
  if (only.length && !only.includes(name)) {
    continue;
  }
  const file = path.join(workDir, `${name}.log`);
  fs.writeFileSync(file, make());
  const started = Date.now();
  try {
    const r = await withSanitizedUpload({ filePath: file }, () => ({
      success: true,
    }));
    console.log(
      `${name}: ok (${Date.now() - started} ms) redactions=${r.sanitization.redactions} rss=${Math.round(process.memoryUsage().rss / 1048576)}MiB`
    );
  } catch (error) {
    console.log(
      `${name}: ${error.message} [${error.cause?.code}] (${Date.now() - started} ms)`
    );
  } finally {
    fs.rmSync(file, { force: true });
  }
}

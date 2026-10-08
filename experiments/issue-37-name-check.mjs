// Read-only, uncached npm name and similar-name probe. No publication occurs.
import { mkdir, writeFile } from 'node:fs/promises';
const names = [
  'gh-upload',
  'ghupload',
  'gh_upload',
  'gh.upload',
  'gh-upload-file',
  'ghuploadfile',
  'gh_upload_file',
  'gh.upload.file',
];
const results = [];
for (const name of names) {
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(name)}?check=${Date.now()}`,
    {
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      signal: globalThis.AbortSignal.timeout(30_000),
    }
  );
  results.push({
    name,
    status: response.status,
    checkedAt: new Date().toISOString(),
  });
  await response.body?.cancel();
}
await mkdir('experiments/output/issue-37', { recursive: true });
await writeFile(
  'experiments/output/issue-37/npm-names.json',
  `${JSON.stringify(results, null, 2)}\n`
);
console.log(JSON.stringify(results, null, 2));

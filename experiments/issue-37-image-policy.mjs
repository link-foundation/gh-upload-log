// Probe the optional image backend's policy endpoint without uploading a file.
// Credentials stay in memory and are never included in the saved evidence.
import { execFileSync } from 'node:child_process';
import { URLSearchParams } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
const token = execFileSync('gh', ['auth', 'token'], {
  encoding: 'utf8',
}).trim();
const repositoryId = execFileSync(
  'gh',
  ['api', 'repos/link-foundation/gh-upload-log', '--jq', '.id'],
  { encoding: 'utf8' }
).trim();
const response = await fetch('https://github.com/upload/policies/assets', {
  method: 'POST',
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded',
    Authorization: `token ${token}`,
    'User-Agent': 'gh-upload-image/0.1.0',
  },
  body: new URLSearchParams({
    name: 'issue-37-probe.png',
    size: '70',
    content_type: 'image/png',
    repository_id: repositoryId,
  }),
  signal: globalThis.AbortSignal.timeout(30_000),
});
const evidence = {
  checkedAt: new Date().toISOString(),
  status: response.status,
  contentType: response.headers.get('content-type'),
  uploadedFile: false,
};
await response.body?.cancel();
await mkdir('experiments/output/issue-37', { recursive: true });
await writeFile(
  'experiments/output/issue-37/image-policy.json',
  `${JSON.stringify(evidence, null, 2)}\n`
);
console.log(JSON.stringify(evidence, null, 2));

// Issue 65: per-call overhead of sanitizeStream, to size a segmented workaround.
import { performance } from 'node:perf_hooks';
import { sanitizeStream } from '@link-foundation/sensitive-data-sanitizer';
const opts = { credentialsOnly: true, knownSecrets: [] };
const t = performance.now();
const n = 200;
for (let i = 0; i < n; i++) {
  for await (const c of sanitizeStream([Buffer.from(`line ${i}\nmore\n`)], {
    allowBinary: true,
    sanitizerOptions: opts,
  })) {
    void c;
  }
}
console.log(
  `${((performance.now() - t) / n).toFixed(2)} ms per sanitizeStream call`
);

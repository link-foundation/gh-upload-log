// Verify what happens when the sanitizer's stream gets a fixed record budget.
// node --max-old-space-size=128 experiments/issue-67-record-limit.mjs
import assert from 'node:assert/strict';
import { sanitizeStream } from '@link-foundation/sensitive-data-sanitizer';

const recordBudget = 64 * 1024;
const block = Buffer.from('🌲'.repeat(4096));
async function* record() {
  for (let i = 0; i < 8; i += 1) {
    yield block;
  }
  yield Buffer.from('\n');
}

let outputBytes = 0;
await assert.rejects(
  async () => {
    for await (const text of sanitizeStream(record(), {
      maxRecordBytes: recordBudget,
      maxTotalBytes: 8 * block.length + 1,
      sanitizerOptions: { credentialsOnly: true },
    })) {
      outputBytes += Buffer.byteLength(text);
    }
  },
  { code: 'ERR_LIMIT' }
);
assert.equal(outputBytes, 0);
console.log('The fixed 64 KiB record limit refused the 128 KiB UTF-8 record.');

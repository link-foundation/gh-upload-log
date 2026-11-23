// Verify what happens when the sanitizer's stream gets a fixed record budget.
// node --max-old-space-size=128 experiments/issue-67-record-limit.mjs
import assert from 'node:assert/strict';
import {
  createSanitizer,
  sanitizeStream,
} from '@link-foundation/sensitive-data-sanitizer';

const recordBudget = 64 * 1024;
const sanitizerOptions = { credentialsOnly: true };
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
      sanitizerOptions,
    })) {
      outputBytes += Buffer.byteLength(text);
    }
  },
  { code: 'ERR_LIMIT' }
);
assert.equal(outputBytes, 0);
console.log('The fixed 64 KiB record limit refused the 128 KiB UTF-8 record.');

const engine = createSanitizer(sanitizerOptions);
const value = 'z'.repeat(recordBudget * 2);
const input = `password="${value}END"\n`;
const complete = await engine.sanitize(input);
assert.equal(complete.text, 'password="[REDACTED]"\n');

let independentlyVerified = '';
for (let offset = 0; offset < input.length; offset += recordBudget) {
  const window = input.slice(offset, offset + recordBudget);
  independentlyVerified += (await engine.sanitize(window)).text;
}
assert.ok(independentlyVerified.includes(value.slice(0, recordBudget)));
console.log(
  'Verifying fixed windows independently retained part of a synthetic credential.'
);

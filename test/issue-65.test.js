import { test } from 'bun:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sanitizeFileToFile } from '@link-foundation/sensitive-data-sanitizer';
import { withSanitizedUpload } from '../src/sanitization.js';
import {
  SEGMENT_SPAN_BYTES,
  advanceNetrc,
  sanitizeFileInSegments,
  segmentCuts,
} from '../src/sanitization-segments.js';

const options = {
  allowBinary: true,
  sanitizerOptions: { credentialsOnly: true },
};
const line = (i) =>
  `2026-11-12T00:00:00.000Z INFO ordinary log line ${i} some text here and more text to pad the line\n`;
const lines = (from, count) =>
  Array.from({ length: count }, (_, i) => line(from + i)).join('');
const token = `ghp_${'A1b2C3d4E5f6G7h8I9j0'.repeat(2).slice(0, 36)}`;

async function withDir(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-65-'));
  try {
    return await run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function cutsOf(file) {
  const handle = await fs.promises.open(file);
  try {
    return await segmentCuts(handle, (await handle.stat()).size);
  } finally {
    await handle.close();
  }
}

test('netrc tracking abandons lines that cannot start an entry', () => {
  assert.equal(advanceNetrc(0, 'default = ["macro"]\n'), 0);
  assert.equal(advanceNetrc(0, 'machine learning is fun\n'), 0);
  assert.equal(advanceNetrc(0, 'default LocaleContext value\n'), 0);
  let step = advanceNetrc(0, 'machine api.example.net\n');
  assert.notEqual(step, 0);
  step = advanceNetrc(step, '  login alice\n');
  assert.notEqual(step, 0);
  assert.equal(advanceNetrc(step, '  password hunter2\n'), 0);
  assert.equal(advanceNetrc(0, 'default login a password b\n'), 0);
  assert.notEqual(advanceNetrc(0, 'x = 1; default login a\n'), 0);
});

test('logs without a netrc trigger keep the single library pass', async () => {
  await withDir(async (dir) => {
    const file = path.join(dir, 'plain.log');
    fs.writeFileSync(file, lines(0, 3000));
    assert.deepEqual(await cutsOf(file), []);
  });
});

test('cuts wait until PEM, quoted and netrc records are complete', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  await withDir(async (dir) => {
    for (const held of [
      privateKey,
      'value = "first\nsecond\nthird"\n',
      'machine api.example.net\nlogin alice\npassword hunter2xyz\n',
    ]) {
      // A cut becomes due 64 KiB after the trigger, inside the held record.
      let head = `default = ["macro"]\n${lines(0, 600)}`;
      head += `${'.'.repeat(SEGMENT_SPAN_BYTES - 10 - head.length - 1)}\n`;
      const text = `${head}${held}${lines(1000, 100)}`;
      const file = path.join(dir, 'held.log');
      fs.writeFileSync(file, text);
      const cuts = await cutsOf(file);
      assert.deepEqual(cuts, [Buffer.byteLength(head + held)]);
    }
  });
});

test('segmented output equals the single library pass', async () => {
  await withDir(async (dir) => {
    const file = path.join(dir, 'mixed.log');
    fs.writeFileSync(
      file,
      [
        'default = ["macro"]\n',
        lines(0, 700),
        `token ${token}\npassword=Sup3rS3cretValue99\n`,
        'machine api.example.net\nlogin alice\npassword hunter2xyz\n',
        'machine learning is fun\n',
        lines(700, 700),
        `again ${token}\n`,
        Buffer.from([0xff, 0xfe, 0x0a]).toString('latin1'),
        lines(1400, 10),
      ].join('')
    );
    assert.ok((await cutsOf(file)).length >= 1);
    const whole = path.join(dir, 'whole.out');
    const parts = path.join(dir, 'parts.out');
    const expected = await sanitizeFileToFile(file, whole, options);
    const actual = await sanitizeFileInSegments(file, parts, options);
    assert.deepEqual(fs.readFileSync(parts), fs.readFileSync(whole));
    assert.deepEqual(actual, expected);
    assert.ok(!fs.readFileSync(parts, 'utf8').includes(token));
    assert.ok(!fs.readFileSync(parts, 'utf8').includes('hunter2xyz'));
  });
}, 60000);

test('a default = ["macro"] line no longer makes sanitization quadratic', async () => {
  await withDir(async (dir) => {
    // Before the fix, 32000 lines took about 28 s and 64000 about four times
    // that; with segments both take a few seconds.
    const filePath = path.join(dir, 'issue-65.log');
    const body = `default = ["macro"]\n${lines(0, 64000)}machine learning is fun\n${lines(64000, 2000)}secret ${token}\n`;
    fs.writeFileSync(filePath, body);
    const started = Date.now();
    const result = await withSanitizedUpload({ filePath }, (safe) => {
      const text = fs.readFileSync(safe.filePath, 'utf8');
      assert.ok(!text.includes(token));
      const kept = body.slice(0, body.lastIndexOf('secret '));
      assert.ok(
        text === `${kept}secret [REDACTED]\n`,
        'only the token changes'
      );
      return {};
    });
    assert.equal(result.sanitization.inputBytes, Buffer.byteLength(body));
    assert.equal(result.sanitization.redactions, 1);
    assert.ok(Date.now() - started < 25000, `${Date.now() - started} ms`);
  });
}, 30000);

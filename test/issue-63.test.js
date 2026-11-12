import { test } from 'bun:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createSanitizer } from '@link-foundation/sensitive-data-sanitizer';
import {
  SANITIZATION_EXIT_CODES,
  sanitizationError,
  withSanitizedUpload,
} from '../src/sanitization.js';
import { summarizeRedactions } from '../src/sanitization-summary.js';

const options = { credentialsOnly: true };

async function withDir(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-63-'));
  try {
    return await run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest();
}

const base64Line = (i) =>
  Buffer.from(`synthetic payload ${i} `.repeat(4)).toString('base64');

test('dense base64 beyond the 0.12.1 detector limit is uploaded', async () => {
  await withDir(async (dir) => {
    const filePath = path.join(dir, 'dense.log');
    const lines = Array.from({ length: 4200 }, (_, i) => base64Line(i));
    fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
    let uploaded = false;
    const result = await withSanitizedUpload({ filePath }, () => {
      uploaded = true;
      return {};
    });
    assert.equal(uploaded, true);
    assert.equal(result.sanitization.inputBytes, fs.statSync(filePath).size);
  });
}, 60000);

test('a record larger than 64 MiB is sanitized instead of refused', async () => {
  await withDir(async (dir) => {
    const filePath = path.join(dir, 'transcript.jsonl');
    const descriptor = fs.openSync(filePath, 'w');
    const block = Buffer.alloc(1024 * 1024, '.');
    fs.writeSync(descriptor, '{"type":"item","text":"');
    for (let i = 0; i < 65; i += 1) {
      fs.writeSync(descriptor, block);
    }
    fs.writeSync(descriptor, '"}\n{"type":"done"}\n');
    fs.closeSync(descriptor);
    const expected = sha256(filePath);
    const result = await withSanitizedUpload({ filePath }, (safe) => {
      assert.deepEqual(sha256(safe.filePath), expected);
      return {};
    });
    assert.ok(result.sanitization.inputBytes > 65 * 1024 * 1024);
    assert.equal(result.sanitization.redactions, 0);
  });
}, 180000);

test('ERR_LIMIT on an unchanged file is a non-retryable detector limit', async () => {
  await withDir(async (dir) => {
    const filePath = path.join(dir, 'a.log');
    fs.writeFileSync(filePath, 'line\n');
    const upstream = Object.assign(new Error('blocked'), { code: 'ERR_LIMIT' });
    const error = await sanitizationError(upstream, filePath, 5);
    assert.equal(error.code, 'ERR_DETECTOR_LIMIT');
    assert.equal(error.cause.code, 'ERR_LIMIT');
    assert.equal(error.retryable, false);
    assert.equal(error.exitCode, SANITIZATION_EXIT_CODES.notRetryable);
    assert.equal(error.longestRecordBytes, 5);
    assert.match(error.message, /^Sanitization failed \(ERR_DETECTOR_LIMIT\)/);
    assert.match(error.message, /detector, findings or registry limit/);
    assert.match(error.message, /not retryable; nothing was uploaded$/);
  });
});

test('ERR_LIMIT after the file grew is a retryable input change', async () => {
  await withDir(async (dir) => {
    const filePath = path.join(dir, 'a.log');
    fs.writeFileSync(filePath, 'line\nappended while scanning\n');
    const upstream = Object.assign(new Error('blocked'), { code: 'ERR_LIMIT' });
    const error = await sanitizationError(upstream, filePath, 5);
    assert.equal(error.code, 'ERR_INPUT_CHANGED');
    assert.equal(error.retryable, true);
    assert.equal(error.exitCode, SANITIZATION_EXIT_CODES.retryable);
    assert.match(error.message, /changed size while it was being scanned/);
  });
});

test('distinct failures keep distinct codes and retry advice', async () => {
  await withDir(async (dir) => {
    const filePath = path.join(dir, 'a.log');
    fs.writeFileSync(filePath, 'line\n');
    const cases = {
      ENOSPC: true,
      ERR_AUTH: false,
      ERR_ENGINE: false,
      ERR_OUTPUT: false,
    };
    for (const [code, retryable] of Object.entries(cases)) {
      const error = await sanitizationError(
        Object.assign(new Error('x'), { code }),
        filePath,
        5
      );
      assert.equal(error.code, code);
      assert.equal(error.retryable, retryable, code);
    }
    const unknown = await sanitizationError(new Error('x'), filePath, 5);
    assert.equal(unknown.code, 'ERR_SANITIZER');
    const missing = await sanitizationError(
      new Error('x'),
      path.join(dir, 'missing.log'),
      5
    );
    assert.equal(
      missing.message,
      'Sanitization failed (ERR_SANITIZER); not retryable; nothing was uploaded'
    );
  });
});

test('CLI exits 65 and says a deterministic refusal cannot succeed', async () => {
  await withDir(async (dir) => {
    const filePath = path.join(dir, 'a.log');
    fs.writeFileSync(filePath, 'line\n');
    fs.writeFileSync(path.join(dir, 'hosts.yml'), 'bad: [unclosed');
    const result = spawnSync(process.execPath, ['src/cli.js', filePath], {
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env, GH_CONFIG_DIR: dir },
    });
    assert.equal(result.status, 65, result.stderr);
    assert.match(result.stderr, /Sanitization failed \(ERR_AUTH\)/);
    assert.match(result.stderr, /retrying the same file cannot succeed/);
  });
}, 60000);

test('counts match a whole-text scan while rescanning only changed lines', async () => {
  await withDir(async (dir) => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const token = `ghp_${'a1B2'.repeat(9)}`;
    const ordinary = Array.from({ length: 50 }, (_, i) => `ordinary ${i}`);
    const text = [
      ...ordinary,
      `password=first-private-value-123`,
      `token ${token} and api_key=second-private-value-456`,
      ...ordinary,
      pem.trimEnd(),
      `after ${token}`,
      'masked ghp…b4N and Bearer 012…567',
      ...ordinary,
      'secret=last-private-value-789',
    ].join('\n');
    const input = path.join(dir, 'in.log');
    const output = path.join(dir, 'out.log');
    fs.writeFileSync(input, text);
    const whole = await createSanitizer(options).sanitize(text);
    fs.writeFileSync(output, whole.text);
    const counted = await summarizeRedactions(input, output, options);
    const rules = Object.create(null);
    for (const finding of whole.findings) {
      if (finding.category === 'credential' && !finding.kept) {
        rules[finding.rule] = (rules[finding.rule] || 0) + 1;
      }
    }
    assert.equal(counted.redactions, whole.redactions);
    assert.deepEqual({ ...counted.rules }, { ...rules });
    assert.ok(counted.regions >= 3 && counted.regions < 10, counted.regions);
  });
});

test('already-masked logs are not scanned a second time for counts', async () => {
  await withDir(async (dir) => {
    const text = `${Array.from(
      { length: 2000 },
      (_, i) => `line ${i} token ghp…b4N and Bearer 012…567`
    ).join('\n')}\n`;
    const filePath = path.join(dir, 'masked.log');
    fs.writeFileSync(filePath, text);
    const result = await withSanitizedUpload({ filePath }, (safe) => {
      assert.equal(fs.readFileSync(safe.filePath, 'utf8'), text);
      return {};
    });
    assert.equal(result.sanitization.redactions, 0);
    const counted = await summarizeRedactions(filePath, filePath, options);
    assert.equal(counted.regions, 0);
  });
}, 60000);

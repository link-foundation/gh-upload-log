import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  knownSecretsFromEnv,
  knownSecretsFromGitHubConfig,
  sanitizeFileToFile,
} from '@link-foundation/sensitive-data-sanitizer';
import { resolveLogFilePath } from './common.js';
import {
  longestRecordBytes,
  summarizeRedactions,
} from './sanitization-summary.js';

// Private state survives option spreads during routing/retries, without exposing
// an option that lets a caller disable sanitization. Never read the source again
// after verification: hashing, compression and upload use this immutable copy.
const verified = Symbol('verified-upload');

// Exit codes from sysexits.h, so automation can tell a deterministic refusal
// (identical bytes can never succeed) from a transient local failure.
export const SANITIZATION_EXIT_CODES = Object.freeze({
  notRetryable: 65, // EX_DATAERR
  retryable: 75, // EX_TEMPFAIL
});

// Local conditions that can clear without changing the input file.
const RETRYABLE_CODES = new Set([
  'ERR_INPUT_CHANGED',
  'ENOSPC',
  'EAGAIN',
  'EBUSY',
  'EMFILE',
  'ENFILE',
  'ENOMEM',
  'ETIMEDOUT',
]);

const REASONS = {
  ERR_DETECTOR_LIMIT:
    'a sanitizer detector, findings or registry limit was reached by this ' +
    'content; retrying the same bytes cannot succeed',
  ERR_INPUT_CHANGED:
    'the file changed size while it was being scanned; retry once it is complete',
  ERR_AUTH: 'local GitHub credential configuration could not be read safely',
  ERR_FILE: 'input is not a readable regular file',
  ERR_OUTPUT: 'private sanitized output could not be written',
  ERR_ENGINE: 'a required credential detector failed',
  ENOSPC: 'not enough disk space for private sanitized output',
  EACCES: 'permission denied while preparing sanitized output',
};

export function uploadSourcePath(options) {
  return options[verified]?.source || resolveLogFilePath(options.filePath);
}

function safeCode(error) {
  // Upstream errors contain safe codes rather than matched credentials.
  return /^(?:ERR_[A-Z_]+|E[A-Z0-9]+)$/.test(error?.code)
    ? error.code
    : 'ERR_SANITIZER';
}

function sizeOf(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return -1;
  }
}

/**
 * Turn a sanitizer failure into an error whose `code`, `reason` and
 * `retryable` fields let callers react without parsing the message.
 * The upstream `ERR_LIMIT` stays available as `cause.code`.
 */
export async function sanitizationError(error, inputPath, scannedBytes) {
  let code = safeCode(error);
  if (code === 'ERR_LIMIT') {
    // Record and total bounds equal the scanned size, so the only byte limit
    // the file can cross is growth during the scan. Everything else is a
    // content-dependent detector, findings or registry limit.
    code =
      sizeOf(inputPath) === scannedBytes
        ? 'ERR_DETECTOR_LIMIT'
        : 'ERR_INPUT_CHANGED';
  }
  const retryable = RETRYABLE_CODES.has(code);
  let longestRecord;
  if (code !== 'ERR_INPUT_CHANGED' && code !== 'ERR_FILE') {
    longestRecord = await longestRecordBytes(inputPath).catch(() => undefined);
  }
  const details = [
    REASONS[code],
    longestRecord !== undefined && `longest record ${longestRecord} bytes`,
  ].filter(Boolean);
  return Object.assign(
    new Error(
      `Sanitization failed (${code}) (${details.join('; ')}); ${
        retryable ? 'retryable' : 'not retryable'
      }; nothing was uploaded`,
      { cause: error }
    ),
    {
      code,
      reason: REASONS[code] || 'sanitization failed',
      retryable,
      exitCode: retryable
        ? SANITIZATION_EXIT_CODES.retryable
        : SANITIZATION_EXIT_CODES.notRetryable,
      longestRecordBytes: longestRecord,
      sanitizationFailure: true,
    }
  );
}

export async function withSanitizedUpload(options, upload) {
  if (options[verified] && options[verified].filePath === options.filePath) {
    return upload(options);
  }
  if (!options.filePath) {
    throw new Error('filePath is required in options');
  }
  const source = resolveLogFilePath(options.filePath);
  if (!fs.existsSync(source)) {
    throw new Error(`File does not exist: ${source}`);
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-upload-safe-'));
  const filePath = path.join(directory, path.basename(source));
  let summary;
  try {
    let inputPath = source;
    let scannedBytes = -1;
    try {
      // Preserve support for caller-supplied symlinks without asking the atomic
      // file API to follow one. Upload naming still uses the supplied path.
      inputPath = fs.realpathSync(source);
      scannedBytes = fs.statSync(inputPath).size;
      const sanitizerOptions = {
        credentialsOnly: true,
        knownSecrets: [
          ...knownSecretsFromEnv(),
          ...(await knownSecretsFromGitHubConfig()),
        ],
      };
      // One verified engine pass. A counting callback would make the file API
      // run the engine again over the callback output (about 3x slower on
      // mask-heavy logs). A logical record may be as large as the file: it is
      // held whole in memory, so huge records cost memory, not a refusal.
      const sizes = await sanitizeFileToFile(inputPath, filePath, {
        allowBinary: true,
        maxRecordBytes: Math.max(1, scannedBytes),
        maxTotalBytes: Math.max(1, scannedBytes),
        sanitizerOptions,
      });
      const counts = await summarizeRedactions(
        inputPath,
        filePath,
        sanitizerOptions
      );
      summary = {
        redactions: counts.redactions,
        rules: counts.rules,
        ...sizes,
      };
      options.verbose &&
        (options.logger || console).log(
          `Sanitization verified ${sizes.inputBytes} input bytes, ${sizes.outputBytes} output bytes; ${counts.regions} changed region(s) counted`
        );
    } catch (error) {
      throw await sanitizationError(error, inputPath, scannedBytes);
    }
    const result = await upload({
      ...options,
      filePath,
      [verified]: { source, filePath },
    });
    return { ...result, sanitization: summary };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

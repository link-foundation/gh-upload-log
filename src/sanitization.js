import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createSanitizer,
  knownSecretsFromEnv,
  knownSecretsFromGitHubConfig,
  sanitizeFileToFile,
} from '@link-foundation/sensitive-data-sanitizer';
import { resolveLogFilePath } from './common.js';

// Private state survives option spreads during routing/retries, without exposing
// an option that lets a caller disable sanitization. Never read the source again
// after verification: hashing, compression and upload use this immutable copy.
const verified = Symbol('verified-upload');
const MAX_RECORD_BYTES = 64 * 1024 * 1024;

export function uploadSourcePath(options) {
  return options[verified]?.source || resolveLogFilePath(options.filePath);
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
  const summary = { redactions: 0, rules: Object.create(null) };
  try {
    try {
      // Preserve support for caller-supplied symlinks without asking the atomic
      // file API to follow one. Upload naming still uses the supplied path.
      const inputPath = fs.realpathSync(source);
      const sanitizerOptions = {
        credentialsOnly: true,
        knownSecrets: [
          ...knownSecretsFromEnv(),
          ...(await knownSecretsFromGitHubConfig()),
        ],
        maxInputLength: MAX_RECORD_BYTES + 1,
      };
      const engine = createSanitizer(sanitizerOptions);
      const sizes = await sanitizeFileToFile(inputPath, filePath, {
        allowBinary: true,
        maxRecordBytes: MAX_RECORD_BYTES,
        maxTotalBytes: Math.max(1, fs.statSync(inputPath).size),
        sanitizerOptions,
        // The file API verifies this callback's output again with the required
        // engine union. Count only the original pass, never the residual scan.
        sanitizer: {
          async sanitize(text) {
            const result = await engine.sanitize(text);
            summary.redactions += result.redactions;
            for (const finding of result.findings) {
              if (finding.category === 'credential' && !finding.kept) {
                summary.rules[finding.rule] =
                  (summary.rules[finding.rule] || 0) + 1;
              }
            }
            return result;
          },
        },
      });
      Object.assign(summary, sizes);
      options.verbose &&
        (options.logger || console).log(
          `Sanitization verified ${sizes.inputBytes} input bytes, ${sizes.outputBytes} output bytes`
        );
    } catch (error) {
      // Upstream errors contain safe codes rather than matched credentials.
      const code = /^(?:ERR_[A-Z_]+|E[A-Z0-9]+)$/.test(error.code)
        ? error.code
        : 'ERR_SANITIZER';
      const reasons = {
        ERR_LIMIT: 'record exceeds 64 MiB or detector limit',
        ERR_AUTH:
          'local GitHub credential configuration could not be read safely',
        ERR_FILE: 'input is not a readable regular file',
        ERR_OUTPUT: 'private sanitized output could not be written',
        ERR_ENGINE: 'a required credential detector failed',
        ENOSPC: 'not enough disk space for private sanitized output',
        EACCES: 'permission denied while preparing sanitized output',
      };
      const reason = reasons[code] ? ` (${reasons[code]})` : '';
      throw new Error(
        `Sanitization failed (${code})${reason}; nothing was uploaded`,
        { cause: error }
      );
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

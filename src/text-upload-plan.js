import fs from 'node:fs';
import { createHash } from 'node:crypto';
import {
  encodeLogText,
  knownSecretsFromEnv,
  knownSecretsFromGitHubConfig,
  sanitizeStream,
} from '@link-foundation/sensitive-data-sanitizer';
import {
  LOG_CONTENT_HASH_LENGTH,
  resolveChunkSize,
  resolveLogFilePath,
} from './common.js';
import { detectFileType } from './file-upload.js';
import {
  hasSanitizedUpload,
  sanitizationError,
  uploadSourcePath,
} from './sanitization.js';
import { summarizeRedactions } from './sanitization-summary.js';

const READ_BYTES = 64 * 1024;
const SINGLE_FILE_FAST_PATH_BYTES = 1024 * 1024;

// Small single-file uploads still use the existing Gist/repository path.
// Only text uploads can use the UTF-8 part planner.
export function isStreamingTextCandidate(options, minimumBytes = 0) {
  if (!options.filePath || options.dryMode || options.onlyGist) {
    return false;
  }
  const source = resolveLogFilePath(options.filePath);
  const stat = fs.statSync(source, { throwIfNoEntry: false });
  return (
    stat?.isFile() &&
    stat.size > minimumBytes &&
    stat.size >
      Math.min(
        SINGLE_FILE_FAST_PATH_BYTES,
        resolveChunkSize(options.chunkSize)
      ) &&
    detectFileType(source) === 'text'
  );
}

function inputChanged() {
  return Object.assign(
    new Error('Log changed during verified upload; retry once it is complete'),
    { code: 'ERR_INPUT_CHANGED', retryable: true }
  );
}

function sameFile(left, right) {
  return ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(
    (key) => left[key] === right[key]
  );
}

async function* verifiedBytes(source, snapshot, sanitizerOptions) {
  const input = await fs.promises.open(
    source,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
  );
  try {
    if (!sameFile(await input.stat({ bigint: true }), snapshot)) {
      throw inputChanged();
    }
    const bytes = Math.max(1, Number(snapshot.size));
    const contents = input.createReadStream({
      highWaterMark: READ_BYTES,
      autoClose: false,
    });
    if (sanitizerOptions) {
      for await (const text of sanitizeStream(contents, {
        allowBinary: true,
        maxRecordBytes: bytes,
        maxTotalBytes: bytes,
        sanitizerOptions,
      })) {
        yield encodeLogText(text);
      }
    } else {
      yield* contents;
    }
    if (!sameFile(await input.stat({ bigint: true }), snapshot)) {
      throw inputChanged();
    }
  } finally {
    await input.close();
  }
}

/** Yield a borrowed view of one part. Consume it before advancing. */
async function* splitText(source, limit) {
  const capacity = limit + 1;
  let buffer = Buffer.allocUnsafe(Math.min(capacity, READ_BYTES));
  let length = 0;
  let sawPart = false;
  for await (const bytes of source) {
    let offset = 0;
    while (offset < bytes.length) {
      const copied = Math.min(bytes.length - offset, capacity - length);
      if (length + copied > buffer.length) {
        const next = Buffer.allocUnsafe(
          Math.min(capacity, Math.max(length + copied, buffer.length * 2))
        );
        buffer.copy(next, 0, 0, length);
        buffer = next;
      }
      bytes.copy(buffer, length, offset, offset + copied);
      length += copied;
      offset += copied;
      if (length <= limit) {
        continue;
      }
      const newline = buffer.subarray(0, limit).lastIndexOf(10);
      let end = newline === -1 ? limit : newline + 1;
      if (newline === -1) {
        while (end > 0 && (buffer[end] & 0xc0) === 0x80) {
          end -= 1;
        }
        // The source was identified as UTF-8 before scanning.
        if (end === 0) {
          throw inputChanged();
        }
      }
      sawPart = true;
      yield buffer.subarray(0, end);
      buffer.copyWithin(0, end, length);
      length -= end;
    }
  }
  if (length || !sawPart) {
    yield buffer.subarray(0, length);
  }
}

function describePart(bytes) {
  return {
    size: bytes.length,
    digest: createHash('sha256').update(bytes).digest('hex'),
    objectId: createHash('sha1')
      .update(`blob ${bytes.length}\0`)
      .update(bytes)
      .digest('hex'),
  };
}

/**
 * Verify the complete input before making any GitHub request. Replay the same
 * open-file snapshot later, comparing each part to its preflight SHA-256 before
 * letting the caller stage it. The plan retains hashes and sizes only.
 */
export async function planTextUpload(options) {
  const source = uploadSourcePath(options);
  const inputPath = fs.realpathSync(resolveLogFilePath(options.filePath));
  const alreadyVerified = hasSanitizedUpload(options);
  const snapshot = fs.statSync(inputPath, { bigint: true });
  const inputBytes = Number(snapshot.size);
  const limit = resolveChunkSize(options.chunkSize);
  const hash = createHash('sha256');
  const parts = [];
  let outputBytes = 0;
  let sanitizerOptions;
  let counts;
  function scan() {
    return splitText(
      verifiedBytes(inputPath, snapshot, sanitizerOptions),
      limit
    );
  }
  function addPart(bytes) {
    parts.push(describePart(bytes));
    hash.update(bytes);
    outputBytes += bytes.length;
  }
  async function* recordParts() {
    for await (const bytes of scan()) {
      addPart(bytes);
      for (let i = 0; i < bytes.length; i += READ_BYTES) {
        yield bytes.subarray(i, i + READ_BYTES);
      }
    }
  }
  try {
    if (alreadyVerified) {
      for await (const bytes of scan()) {
        addPart(bytes);
      }
    } else {
      sanitizerOptions = {
        credentialsOnly: true,
        knownSecrets: [
          ...knownSecretsFromEnv(),
          ...(await knownSecretsFromGitHubConfig()),
        ],
      };
      counts = await summarizeRedactions(
        inputPath,
        recordParts(),
        sanitizerOptions
      );
    }
    if (!sameFile(fs.statSync(inputPath, { bigint: true }), snapshot)) {
      throw inputChanged();
    }
  } catch (error) {
    throw await sanitizationError(error, inputPath, inputBytes);
  }
  const digest = hash.digest('hex');
  const sanitization = {
    redactions: counts?.redactions,
    rules: counts?.rules,
    inputBytes,
    outputBytes,
  };
  counts &&
    options.verbose &&
    (options.logger || console).log(
      `Sanitization verified ${inputBytes} input bytes, ${outputBytes} output bytes; ${counts.regions} changed region(s) counted`
    );
  return {
    source,
    parts,
    contentHash: digest.slice(0, LOG_CONTENT_HASH_LENGTH),
    digest,
    sanitization,
    async *replay() {
      let index = 0;
      for await (const bytes of scan()) {
        const expected = parts[index++];
        if (
          !sameFile(fs.statSync(inputPath, { bigint: true }), snapshot) ||
          !expected ||
          bytes.length !== expected.size ||
          createHash('sha256').update(bytes).digest('hex') !== expected.digest
        ) {
          throw inputChanged();
        }
        yield bytes;
      }
      if (index !== parts.length) {
        throw inputChanged();
      }
    },
  };
}

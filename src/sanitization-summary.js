import crypto from 'node:crypto';
import fs from 'node:fs';
import { TextDecoder } from 'node:util';
import { createSanitizer } from '@link-foundation/sensitive-data-sanitizer';

// Redaction counts are informational: the sanitizer's single verified pass is
// what makes the upload safe. Rescanning the whole input only to count would
// double (with a callback, triple) the slowest part of an upload, so counts are
// computed only for input lines that the verified output actually changed.
const READ_BYTES = 64 * 1024;
const RESYNC_LINES = 4096;
const CONTEXT_LINES = 16;
const CONTEXT_BYTES = 4096;
const COUNT_WINDOW_BYTES = 8 * 1024 * 1024;

/** Stream `{hash, start, end}` for every `\n`-terminated (or final) line. */
async function* lineBatches(file) {
  const handle = await fs.promises.open(file, 'r');
  try {
    const buffer = Buffer.alloc(READ_BYTES);
    let hash = crypto.createHash('sha1');
    let start = 0;
    let offset = 0;
    let open = false;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, READ_BYTES, null);
      if (!bytesRead) {
        break;
      }
      const chunk = buffer.subarray(0, bytesRead);
      const batch = [];
      let from = 0;
      for (
        let nl = chunk.indexOf(10);
        nl !== -1;
        nl = chunk.indexOf(10, from)
      ) {
        hash.update(chunk.subarray(from, nl + 1));
        batch.push({
          hash: hash.digest('base64'),
          start,
          end: offset + nl + 1,
        });
        hash = crypto.createHash('sha1');
        start = offset + nl + 1;
        from = nl + 1;
      }
      open = from < bytesRead;
      hash.update(chunk.subarray(from));
      offset += bytesRead;
      if (batch.length) {
        yield batch;
      }
    }
    if (open) {
      yield [{ hash: hash.digest('base64'), start, end: offset }];
    }
  } finally {
    await handle.close();
  }
}

/** A line queue with lookahead over `lineBatches`. */
function lineQueue(file) {
  const batches = lineBatches(file);
  let lines = [];
  let head = 0;
  let done = false;
  return {
    get length() {
      return lines.length - head;
    },
    at: (index) => lines[head + index],
    shift(count = 1) {
      head += count;
    },
    async fill(minimum) {
      while (!done && lines.length - head < minimum) {
        const next = await batches.next();
        if (next.done) {
          done = true;
        } else {
          lines = lines.slice(head).concat(next.value);
          head = 0;
        }
      }
    },
  };
}

/** Find the first input line after a change that reappears in the output. */
function resync(input, output) {
  const positions = new Map();
  for (let k = output.length - 1; k >= 1; k -= 1) {
    positions.set(output.at(k).hash, k);
  }
  for (let i = 1; i < input.length; i += 1) {
    const k = positions.get(input.at(i).hash);
    if (k !== undefined) {
      return { changedLines: i, replacementLines: k };
    }
  }
  return { changedLines: input.length, replacementLines: output.length };
}

function readRange(fd, start, end) {
  const bytes = Buffer.alloc(end - start);
  let read = 0;
  while (read < bytes.length) {
    const count = fs.readSync(
      fd,
      bytes,
      read,
      bytes.length - read,
      start + read
    );
    if (!count) {
      break;
    }
    read += count;
  }
  return bytes.subarray(0, read);
}

/** Split a large changed range at line or word boundaries for counting. */
function countWindows(fd, start, end) {
  const windows = [];
  while (end - start > COUNT_WINDOW_BYTES) {
    const tail = readRange(
      fd,
      start + COUNT_WINDOW_BYTES / 2,
      start + COUNT_WINDOW_BYTES
    );
    const cut = Math.max(tail.lastIndexOf(10), tail.lastIndexOf(32));
    const next =
      cut >= 0
        ? start + COUNT_WINDOW_BYTES / 2 + cut + 1
        : start + COUNT_WINDOW_BYTES;
    windows.push([start, next]);
    start = next;
  }
  windows.push([start, end]);
  return windows;
}

async function countRange(engine, fd, contextStart, start, end, summary) {
  const decoder = () => new TextDecoder('utf-8');
  for (const [from, to] of countWindows(fd, start, end)) {
    const context =
      from === start
        ? decoder().decode(readRange(fd, contextStart, start))
        : '';
    const changed = decoder().decode(readRange(fd, from, to));
    const result = await engine.sanitize(context + changed);
    const spans = [];
    for (const finding of result.findings) {
      if (
        finding.category === 'credential' &&
        !finding.kept &&
        finding.end > context.length
      ) {
        summary.rules[finding.rule] = (summary.rules[finding.rule] || 0) + 1;
        spans.push([finding.start, finding.end]);
      }
    }
    // Merge overlapping detector spans like the sanitizer's redaction count.
    spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let last = -1;
    for (const [spanStart, spanEnd] of spans) {
      if (spanStart >= last) {
        summary.redactions += 1;
      }
      last = Math.max(last, spanEnd);
    }
  }
}

/**
 * Count credential redactions by rescanning only changed input regions.
 * Unchanged lines cannot hold a redaction, so a log with no new credentials
 * (for example one that is already masked) is never scanned twice.
 */
export async function summarizeRedactions(inputPath, outputPath, options) {
  const summary = { redactions: 0, rules: Object.create(null), regions: 0 };
  const engine = createSanitizer(options);
  const input = lineQueue(inputPath);
  const output = lineQueue(outputPath);
  const context = [];
  const fd = fs.openSync(inputPath, 'r');
  try {
    for (;;) {
      await input.fill(RESYNC_LINES);
      await output.fill(RESYNC_LINES);
      if (!input.length) {
        break;
      }
      let matched = false;
      while (
        input.length &&
        output.length &&
        input.at(0).hash === output.at(0).hash
      ) {
        context.push(input.at(0).start);
        context.length > CONTEXT_LINES && context.shift();
        input.shift();
        output.shift();
        matched = true;
      }
      if (matched) {
        // Refill both lookahead windows before searching for a resync point.
        continue;
      }
      const { changedLines, replacementLines } = output.length
        ? resync(input, output)
        : { changedLines: input.length, replacementLines: 0 };
      const start = input.at(0).start;
      const end = input.at(changedLines - 1).end;
      const contextStart =
        context.find((lineStart) => start - lineStart <= CONTEXT_BYTES) ??
        start;
      summary.regions += 1;
      await countRange(engine, fd, contextStart, start, end, summary);
      context.length = 0;
      input.shift(changedLines);
      output.shift(replacementLines);
    }
  } finally {
    fs.closeSync(fd);
  }
  return summary;
}

/** Length in bytes of the longest `\n`-separated record, for diagnostics. */
export async function longestRecordBytes(file) {
  let longest = 0;
  for await (const batch of lineBatches(file)) {
    for (const line of batch) {
      longest = Math.max(longest, line.end - line.start);
    }
  }
  return longest;
}

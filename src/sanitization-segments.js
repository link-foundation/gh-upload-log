import fs from 'node:fs';
import {
  encodeLogText,
  sanitizeFileToFile,
  sanitizeStream,
} from '@link-foundation/sensitive-data-sanitizer';

// Issue 65: sensitive-data-sanitizer (0.22.x) starts a netrc block on any line
// matching NETRC_START, e.g. `default = ["macro"]` or `machine learning is`,
// and only ends it when a full `login … password …` entry follows. Otherwise
// it holds the rest of the input and rescans it per line: quadratic CPU.
// We cut the file into independently sanitized segments after such lines, at
// line ends where the library itself would release a batch. Files without a
// trigger keep the single library pass. Upstream:
// https://github.com/link-foundation/sensitive-data-sanitizer/issues/176
const NETRC_START = /^\s*(?:machine\s+\S+|default)(?:\s|$)/;
// Keep the held span per segment small; a cut costs about 2 ms.
export const SEGMENT_SPAN_BYTES = 64 * 1024;
const NEWLINE = 0x0a;
const debug = /(?:^|,)gh-upload:segments(?:,|$)/.test(process.env.DEBUG || '');

/**
 * Track the sequence `machine <name> | default`, `login <user>`,
 * `password <value>` over whitespace-separated tokens, the way the library's
 * netrc detector matches it. Non-zero means an entry may still complete.
 */
export function advanceNetrc(step, line) {
  for (const token of line.split(/\s+/)) {
    if (!token) {
      continue;
    }
    if (step === 1 || step === 3) {
      step += 1; // host or user
    } else if (step === 2 && token === 'login') {
      step = 3;
    } else if (step === 4 && token === 'password') {
      step = 5;
    } else if (step === 5) {
      step = 0; // value: entry complete
    } else {
      step = token === 'machine' ? 1 : token === 'default' ? 2 : 0;
    }
  }
  return step;
}

// Mirrors the library's quote, PEM, PuTTY and wrapped-base64 holds, so a cut
// never splits a record the library would keep whole.
function advanceQuotes(line, state) {
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (state.escaped) {
      state.escaped = false;
    } else if (char === '\\' && state.quote) {
      state.escaped = true;
    } else if (state.quote && char === state.quote) {
      state.quote = '';
    } else if (
      !state.quote &&
      (char === '"' ||
        (char === "'" && !/[\p{L}\p{N}]/u.test(line[i - 1] ?? '')))
    ) {
      state.quote = char;
    }
  }
}

function advance(line, state) {
  if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(line)) {
    state.pem = true;
  }
  if (/-----END [A-Z0-9 ]*PRIVATE KEY-----/.test(line)) {
    state.pem = false;
  }
  if (/^PuTTY-User-Key-File-[23]:/.test(line)) {
    state.putty = true;
  }
  if (/^Private-MAC:[ \t]*[a-fA-F0-9]+/.test(line)) {
    state.putty = false;
  }
  state.netrc = advanceNetrc(state.netrc, line);
  advanceQuotes(line, state);
}

function releasable(line, state) {
  return (
    !state.quote &&
    !state.pem &&
    !state.putty &&
    state.netrc === 0 &&
    // A line that may begin or continue wrapped base64 is held by the library.
    !/^[A-Za-z0-9+/_-]{1,128}={0,2}\r?\n?$/.test(line)
  );
}

/**
 * Byte offsets after which the file can be cut. Empty when no line can
 * trigger the library's unbounded netrc hold.
 */
export async function segmentCuts(handle, size) {
  const state = { quote: '', escaped: false, pem: false, putty: false };
  state.netrc = 0;
  const cuts = [];
  let held = -1; // offset of the first trigger line since the last cut
  let offset = 0;
  let rest = Buffer.alloc(0);
  const onLine = (bytes) => {
    const line = bytes.toString('utf8');
    if (held < 0 && NETRC_START.test(line)) {
      held = offset;
    }
    advance(line, state);
    offset += bytes.length;
    if (
      held >= 0 &&
      offset - held >= SEGMENT_SPAN_BYTES &&
      offset < size &&
      releasable(line, state)
    ) {
      cuts.push(offset);
      held = -1;
    }
  };
  const stream = handle.createReadStream({
    start: 0,
    end: Math.max(0, size - 1),
    highWaterMark: 65536,
    autoClose: false,
  });
  for await (const chunk of stream) {
    let data = rest.length ? Buffer.concat([rest, chunk]) : chunk;
    let start = 0;
    for (let end; (end = data.indexOf(NEWLINE, start)) >= 0; start = end + 1) {
      onLine(data.subarray(start, end + 1));
    }
    rest = Buffer.from(data.subarray(start));
    data = undefined;
  }
  return cuts;
}

/**
 * sanitizeFileToFile with the issue 65 workaround: same options and result.
 * The last segment keeps the size bound, so a growing file still fails with
 * ERR_LIMIT instead of being silently truncated.
 */
export async function sanitizeFileInSegments(source, target, options) {
  const handle = await fs.promises.open(
    source,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
  );
  let output;
  try {
    const info = await handle.stat();
    const cuts = info.isFile() ? await segmentCuts(handle, info.size) : [];
    debug &&
      console.error(`[gh-upload:segments] ${cuts.length} cut(s) ${cuts}`);
    if (!cuts.length) {
      await handle.close();
      return await sanitizeFileToFile(source, target, options);
    }
    output = await fs.promises.open(target, 'wx', 0o600);
    let outputBytes = 0;
    const bounds = [0, ...cuts];
    for (const [index, start] of bounds.entries()) {
      const end = bounds[index + 1];
      const bytes = (end ?? info.size) - start;
      const chunks = handle.createReadStream({
        start,
        ...(end === undefined ? {} : { end: end - 1 }),
        highWaterMark: 65536,
        autoClose: false,
      });
      for await (const text of sanitizeStream(chunks, {
        ...options,
        maxRecordBytes: Math.max(1, bytes),
        maxTotalBytes: Math.max(1, bytes),
      })) {
        const encoded = encodeLogText(text);
        outputBytes += encoded.length;
        await output.write(encoded);
      }
    }
    await output.sync();
    return { inputBytes: info.size, outputBytes };
  } finally {
    await output?.close();
    await handle.close().catch(() => {});
  }
}

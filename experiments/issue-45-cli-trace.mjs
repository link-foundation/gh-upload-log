// Optional NODE_OPTIONS preload for diagnosing CLI test hangs. Disabled by default.
import fs from 'node:fs';
import { setInterval, clearInterval } from 'node:timers';

const tracePath = process.env.GH_UPLOAD_LOG_TRACE_FILE;
if (tracePath) {
  const started = Date.now();
  const trace = (event, data = {}) =>
    fs.appendFileSync(
      tracePath,
      `${JSON.stringify({ pid: process.pid, elapsed: Date.now() - started, event, ...data })}\n`
    );
  trace('start', { args: process.argv });
  const original = fs.createReadStream;
  fs.createReadStream = (...args) => {
    const stream = original(...args);
    let chunks = 0;
    let samples = 0;
    trace('read-start', { file: String(args[0]) });
    const timer = setInterval(() => {
      trace('read-wait', {
        bytesRead: stream.bytesRead,
        chunks,
        destroyed: stream.destroyed,
        readableLength: stream.readableLength,
      });
      if (++samples === 10) {
        clearInterval(timer);
      }
    }, 1000);
    timer.unref();
    stream.on('data', () => {
      chunks += 1;
    });
    stream.on('end', () => {
      clearInterval(timer);
      trace('read-end', { bytesRead: stream.bytesRead, chunks });
    });
    stream.on('error', (error) => {
      clearInterval(timer);
      trace('read-error', { message: error.message });
    });
    return stream;
  };
  process.on('exit', (code) => trace('exit', { code }));
}

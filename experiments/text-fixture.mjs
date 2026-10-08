// Make finite text fixtures without allocating a file-sized buffer.
import fs from 'node:fs';
export function writeTextFixture(filePath, sizeBytes) {
  const descriptor = fs.openSync(filePath, 'w');
  const buffer = Buffer.alloc(64 * 1024, 120);
  try {
    for (let offset = 0; offset < sizeBytes; offset += buffer.length) {
      fs.writeSync(
        descriptor,
        buffer.subarray(0, Math.min(buffer.length, sizeBytes - offset))
      );
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

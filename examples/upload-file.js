#!/usr/bin/env bun
// Usage: bun examples/upload-file.js /path/to/photo.png --dry
import { uploadFile } from '../src/index.js';

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: bun examples/upload-file.js <file> [--dry]');
  process.exit(1);
}
const result = await uploadFile({
  filePath,
  dryMode: process.argv.includes('--dry'),
  verbose: true,
});
console.log(
  JSON.stringify(
    {
      url: result.url,
      fileType: result.fileType,
      archiveFormat: result.archiveFormat,
      originalFileName: result.originalFileName,
      fileName: result.fileName,
      fileCount: result.fileCount,
      fileCountIsEstimate: result.fileCountIsEstimate || false,
    },
    null,
    2
  )
);

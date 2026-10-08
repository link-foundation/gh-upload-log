import fs from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import {
  generateStoredLogFileName,
  getFileSize,
  MAX_UPLOADED_FILE_NAME_LENGTH,
  normalizeFileName,
  resolveChunkSize,
  shortenGeneratedName,
  splitFileIntoChunks,
} from './common.js';

/**
 * Inspect every byte with bounded memory. Gists require valid UTF-8 text;
 * NUL and non-text control bytes also select binary mode. ANSI escapes,
 * tabs, CRLF, backspace, and form feed remain valid log text.
 */
export function detectFileType(filePath) {
  const descriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    let length;
    while ((length = fs.readSync(descriptor, buffer)) > 0) {
      const bytes = buffer.subarray(0, length);
      try {
        const text = decoder.decode(bytes, { stream: true });
        // eslint-disable-next-line no-control-regex -- Control bytes intentionally identify binary input.
        if (/[\x00-\x06\x0b\x0e-\x1a\x1c-\x1f]/.test(text)) {
          return 'binary';
        }
      } catch {
        return 'binary';
      }
    }
    try {
      decoder.decode();
      return 'text';
    } catch {
      return 'binary';
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

/** Names and metadata refer to the source, even when staging an archive. */
export function getFileUploadInfo(filePath) {
  const fileType = detectFileType(filePath);
  const originalFileName = path.basename(filePath);
  let fileName =
    fileType === 'binary'
      ? `${shortenGeneratedName(normalizeFileName(originalFileName), MAX_UPLOADED_FILE_NAME_LENGTH - 3)}.gz`
      : generateStoredLogFileName(filePath);
  // Hidden source files must not be confused with completion markers.
  if (fileName.startsWith('.')) {
    fileName = `file-${fileName}`;
  }
  return {
    fileType,
    archiveFormat: fileType === 'binary' ? 'gzip' : null,
    originalFileName,
    fileName,
  };
}

/** Recognize archive parts independently from the existing log naming scheme. */
export function isStoredFileName(entryName, info) {
  if (entryName === info.fileName) {
    return true;
  }
  const prefix =
    info.fileType === 'binary'
      ? `${info.fileName}.part-`
      : `${info.fileName.slice(0, -'.log.txt'.length)}.part-`;
  const suffix = info.fileType === 'binary' ? '' : '.log.txt';
  return (
    entryName.startsWith(prefix) &&
    entryName.endsWith(suffix) &&
    /^\d+$/.test(
      entryName.slice(prefix.length, suffix ? -suffix.length : undefined)
    )
  );
}

/** Split archive bytes without line or character interpretation, using 64KB memory. */
export async function splitBinaryFile(
  inputPath,
  outputDir,
  fileName,
  chunkSize
) {
  resolveChunkSize(chunkSize);
  const fileSize = getFileSize(inputPath);
  const width = Math.max(2, String(Math.ceil(fileSize / chunkSize) - 1).length);
  const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, chunkSize));
  const input = await fs.promises.open(inputPath, 'r');
  const files = [];
  let offset = 0;
  try {
    while (offset < fileSize) {
      const name = `${fileName}.part-${String(files.length).padStart(width, '0')}`;
      const output = await fs.promises.open(path.join(outputDir, name), 'w');
      const end = Math.min(offset + chunkSize, fileSize);
      try {
        while (offset < end) {
          const { bytesRead } = await input.read(
            buffer,
            0,
            Math.min(buffer.length, end - offset),
            offset
          );
          if (bytesRead === 0) {
            throw new Error('File changed while splitting archive');
          }
          await output.writeFile(buffer.subarray(0, bytesRead));
          offset += bytesRead;
        }
      } finally {
        await output.close();
      }
      files.push(name);
    }
  } finally {
    await input.close();
  }
  return files;
}

/**
 * Stream binary input into a deterministic gzip archive, then bound the actual
 * archived bytes (including headers/trailers) by the repository file limit.
 */
export async function stageUploadFiles(
  filePath,
  outputDir,
  chunkSize,
  info = getFileUploadInfo(filePath)
) {
  resolveChunkSize(chunkSize);
  fs.mkdirSync(outputDir, { recursive: true });
  if (info.fileType === 'text') {
    if (getFileSize(filePath) > chunkSize) {
      const files = await splitFileIntoChunks(filePath, outputDir, chunkSize);
      return files.map((file) => {
        const name = path.basename(file);
        if (!name.startsWith('.')) {
          return name;
        }
        fs.renameSync(file, path.join(outputDir, `file-${name}`));
        return `file-${name}`;
      });
    }
    fs.copyFileSync(filePath, path.join(outputDir, info.fileName));
    return [info.fileName];
  }
  const archivePath = path.join(outputDir, info.fileName);
  await pipeline(
    fs.createReadStream(filePath),
    createGzip(),
    fs.createWriteStream(archivePath)
  );
  if (getFileSize(archivePath) <= chunkSize) {
    return [info.fileName];
  }
  const files = await splitBinaryFile(
    archivePath,
    outputDir,
    info.fileName,
    chunkSize
  );
  fs.unlinkSync(archivePath);
  return files;
}

#!/usr/bin/env node

/**
 * Generate text files of specified sizes for testing
 *
 * Usage:
 *   bun scripts/generate-test-file.mjs <size-in-mb> [output-path]
 *
 * Examples:
 *   bun scripts/generate-test-file.mjs 10          # Creates test-10mb.log
 *   bun scripts/generate-test-file.mjs 50 /tmp/test.log
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Generate a text file of approximately the specified size
 *
 * @param {number} sizeMB - Target size in megabytes
 * @param {string} outputPath - Output file path
 * @returns {Object} File info including actual size
 */
export function generateTestFile(sizeMB, outputPath) {
  const targetBytes = sizeMB * 1024 * 1024;

  // Generate text content in chunks to avoid memory issues
  // Using a realistic log line pattern
  const lineTemplate =
    '[2025-01-07T12:00:00.000Z] INFO  Application log entry #%LINE% - Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.\n';
  const lineSize = lineTemplate.length;
  const linesNeeded = Math.ceil(targetBytes / lineSize);

  // Write in chunks to handle large files efficiently
  const chunkLines = 10000;
  const fd = fs.openSync(outputPath, 'w');

  let lineNumber = 0;
  while (lineNumber < linesNeeded) {
    const lines = [];
    for (let i = 0; i < chunkLines && lineNumber < linesNeeded; i++) {
      lineNumber++;
      lines.push(lineTemplate.replace('%LINE%', String(lineNumber)));
    }
    fs.writeSync(fd, lines.join(''));
  }

  fs.closeSync(fd);

  const actualSize = fs.statSync(outputPath).size;
  return {
    path: outputPath,
    targetMB: sizeMB,
    actualBytes: actualSize,
    actualMB: (actualSize / (1024 * 1024)).toFixed(2),
  };
}

/**
 * Generate multiple test files of various sizes
 *
 * @param {number[]} sizes - Array of sizes in MB
 * @param {string} outputDir - Output directory
 * @returns {Object[]} Array of file info objects
 */
export function generateTestFiles(sizes, outputDir) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  return sizes.map((sizeMB) => {
    const outputPath = path.join(outputDir, `test-${sizeMB}mb.log`);
    return generateTestFile(sizeMB, outputPath);
  });
}

// CLI handling
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(
      'Usage: bun scripts/generate-test-file.mjs <size-in-mb> [output-path]'
    );
    console.log('');
    console.log('Examples:');
    console.log(
      '  bun scripts/generate-test-file.mjs 10          # Creates test-10mb.log'
    );
    console.log('  bun scripts/generate-test-file.mjs 50 /tmp/test.log');
    process.exit(1);
  }

  const sizeMB = parseInt(args[0], 10);
  if (isNaN(sizeMB) || sizeMB <= 0) {
    console.error('Error: Size must be a positive integer in megabytes');
    process.exit(1);
  }

  const outputPath = args[1] || `test-${sizeMB}mb.log`;

  console.log(`Generating ${sizeMB}MB test file...`);
  const result = generateTestFile(sizeMB, outputPath);
  console.log(`Created: ${result.path}`);
  console.log(
    `Actual size: ${result.actualMB} MB (${result.actualBytes} bytes)`
  );
}

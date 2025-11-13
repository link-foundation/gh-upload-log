#!/usr/bin/env node

/**
 * Example: Basic usage of gh-upload-log as a library
 */

import { uploadLog } from '../src/index.js';
import fs from 'fs';
import path from 'path';

async function main() {
  // Create a sample log file for demonstration
  const logFile = path.join(process.cwd(), 'examples', 'sample.log');

  console.log('Creating sample log file...');
  const logContent = Array(100)
    .fill(0)
    .map((_, i) => `[${new Date().toISOString()}] Log entry ${i + 1}: Sample log message`)
    .join('\n');

  fs.writeFileSync(logFile, logContent);
  console.log(`Created: ${logFile}`);
  console.log(`Size: ${fs.statSync(logFile).size} bytes`);
  console.log('');

  try {
    // Example 1: Upload as private (default)
    console.log('Example 1: Uploading as private gist/repo...');
    const result1 = await uploadLog(logFile, {
      isPublic: false,
      description: 'Sample log file from gh-upload-log example'
    });
    console.log('Result:', result1);
    console.log('');

    // Example 2: Upload as public
    console.log('Example 2: Uploading as public gist/repo...');
    const result2 = await uploadLog(logFile, {
      isPublic: true,
      description: 'Public sample log file'
    });
    console.log('Result:', result2);
    console.log('');

    // Clean up
    console.log('Cleaning up sample file...');
    fs.unlinkSync(logFile);
    console.log('Done!');
  } catch (error) {
    console.error('Error:', error.message);
    // Clean up on error
    if (fs.existsSync(logFile)) {
      fs.unlinkSync(logFile);
    }
    process.exit(1);
  }
}

main();

#!/usr/bin/env node

/**
 * Experiment to understand lino-arguments behavior with conflicting boolean options
 */

import { makeConfig } from 'lino-arguments';

console.log('=== Test 1: Basic yargs with conflicts ===');
const config = makeConfig({
  yargs: ({ yargs, getenv }) =>
    yargs
      .usage('Usage: $0 <log-file> [options]')
      .command('$0 <logFile>', 'Upload a log file to GitHub', (yargs) => {
        yargs.positional('logFile', {
          describe: 'Path to the log file to upload',
          type: 'string',
        });
      })
      .option('public', {
        alias: 'p',
        type: 'boolean',
        description: 'Make the upload public (default: private)',
        default: getenv('GH_UPLOAD_LOG_PUBLIC', false),
      })
      .option('private', {
        type: 'boolean',
        description: 'Make the upload private (default)',
        default: getenv('GH_UPLOAD_LOG_PRIVATE', true),
      })
      .conflicts('public', 'private')
      .strict(),
});

console.log('config.logFile:', config.logFile);
console.log('config.public:', config.public);
console.log('config.private:', config.private);
console.log('Full config:', config);

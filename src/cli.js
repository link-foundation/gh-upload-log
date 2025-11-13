#!/usr/bin/env node

/**
 * gh-upload-log CLI
 *
 * Command-line interface for uploading log files to GitHub
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { uploadLog } from './index.js';

// Parse command-line arguments
const argv = yargs(hideBin(process.argv))
  .usage('Usage: $0 <log-file> [options]')
  .command('$0 <logFile>', 'Upload a log file to GitHub', (yargs) => {
    yargs.positional('logFile', {
      describe: 'Path to the log file to upload',
      type: 'string'
    });
  })
  .option('public', {
    alias: 'p',
    type: 'boolean',
    description: 'Make the upload public (default: private)',
    default: false
  })
  .option('private', {
    type: 'boolean',
    description: 'Make the upload private (default)',
    default: true
  })
  .option('force-gist', {
    type: 'boolean',
    description: 'Force upload as GitHub Gist',
    default: false
  })
  .option('force-repo', {
    type: 'boolean',
    description: 'Force upload as GitHub Repository',
    default: false
  })
  .option('description', {
    alias: 'd',
    type: 'string',
    description: 'Description for the upload'
  })
  .option('verbose', {
    alias: 'v',
    type: 'boolean',
    description: 'Enable verbose output',
    default: false
  })
  .conflicts('public', 'private')
  .conflicts('force-gist', 'force-repo')
  .example('$0 /var/log/app.log', 'Upload log file as private gist/repo')
  .example('$0 /var/log/app.log --public', 'Upload log file as public gist/repo')
  .example('$0 ./error.log --force-gist', 'Force upload as gist')
  .example('$0 ./large.log --force-repo --public', 'Force upload as public repository')
  .help('h')
  .alias('h', 'help')
  .version('0.1.0')
  .alias('v', 'version')
  .strict()
  .parse();

/**
 * Main CLI function
 */
async function main() {
  try {
    const logFile = argv.logFile;

    if (!logFile) {
      console.error('Error: Log file path is required');
      console.error('Usage: gh-upload-log <log-file> [options]');
      console.error('Run "gh-upload-log --help" for more information');
      process.exit(1);
    }

    // Prepare options
    const options = {
      isPublic: argv.public,
      forceGist: argv.forceGist,
      forceRepo: argv.forceRepo,
      description: argv.description,
      verbose: argv.verbose
    };

    if (options.verbose) {
      console.log('Options:', options);
      console.log('Log file:', logFile);
      console.log('');
    }

    // Upload the log file
    console.log(`Uploading log file: ${logFile}`);
    console.log('');

    const result = await uploadLog(logFile, options);

    // Display results
    console.log('');
    console.log('✓ Upload complete!');
    console.log('');
    console.log(`Type: ${result.type}`);
    console.log(`URL: ${result.url}`);
    console.log(`Visibility: ${result.isPublic ? 'public' : 'private'}`);

    if (result.type === 'gist') {
      console.log(`File name: ${result.fileName}`);
    } else if (result.type === 'repo') {
      console.log(`Repository: ${result.repoName}`);
    }

    console.log('');
    console.log('You can access your uploaded log at:');
    console.log(result.url);

    process.exit(0);
  } catch (error) {
    console.error('');
    console.error('✗ Error:', error.message);

    if (argv.verbose) {
      console.error('');
      console.error('Stack trace:');
      console.error(error.stack);
    }

    process.exit(1);
  }
}

// Run the CLI
main();

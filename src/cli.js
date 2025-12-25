#!/usr/bin/env bun

/**
 * gh-upload-log CLI
 *
 * Command-line interface for uploading log files to GitHub
 */

import { makeConfig } from 'lino-arguments';
import { uploadLog } from './index.js';

// Parse command-line arguments with environment variable and .lenv support
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
      })
      .option('private', {
        type: 'boolean',
        description: 'Make the upload private (default)',
      })
      .option('auto', {
        type: 'boolean',
        description:
          'Automatically choose upload strategy based on file size (default)',
        default: getenv('GH_UPLOAD_LOG_AUTO', true),
      })
      .option('only-gist', {
        type: 'boolean',
        description: 'Upload only as GitHub Gist (disables auto mode)',
      })
      .option('only-repository', {
        type: 'boolean',
        description: 'Upload only as GitHub Repository (disables auto mode)',
      })
      .option('dry-mode', {
        alias: 'dry',
        type: 'boolean',
        description: 'Dry run mode - show what would be done without uploading',
        default: getenv('GH_UPLOAD_LOG_DRY_MODE', false),
      })
      .option('description', {
        alias: 'd',
        type: 'string',
        description: 'Description for the upload',
        default: getenv('GH_UPLOAD_LOG_DESCRIPTION', ''),
      })
      .option('verbose', {
        alias: 'v',
        type: 'boolean',
        description: 'Enable verbose output',
        default: getenv('GH_UPLOAD_LOG_VERBOSE', false),
      })
      .conflicts('public', 'private')
      .conflicts('only-gist', 'only-repository')
      .check((argv) => {
        // If --no-auto is used, require either --only-gist or --only-repository
        if (argv.auto === false && !argv.onlyGist && !argv.onlyRepository) {
          throw new Error(
            'When using --no-auto, you must specify either --only-gist or --only-repository'
          );
        }
        // If --only-gist or --only-repository is used, auto mode is disabled
        if (argv.onlyGist || argv.onlyRepository) {
          argv.auto = false;
        }
        return true;
      })
      .example('$0 /var/log/app.log', 'Upload log file (auto mode, private)')
      .example(
        '$0 /var/log/app.log --public',
        'Upload log file (auto mode, public)'
      )
      .example('$0 ./error.log --only-gist', 'Upload only as gist')
      .example(
        '$0 ./large.log --only-repository --public',
        'Upload only as public repository'
      )
      .example('$0 ./app.log --dry-mode', 'Dry run - show what would be done')
      .help('h')
      .alias('h', 'help')
      .version('0.1.0')
      .strict(),
});

/**
 * Main CLI function
 */
async function main() {
  try {
    const logFile = config.logFile;

    if (!logFile) {
      console.error('Error: Log file path is required');
      console.error('Usage: gh-upload-log <log-file> [options]');
      console.error('Run "gh-upload-log --help" for more information');
      process.exit(1);
    }

    // Prepare options
    // If neither public nor private is specified, default to private
    const isPublic =
      config.public === true ? true : config.private === false ? true : false;

    const options = {
      filePath: logFile,
      isPublic,
      auto: config.auto,
      onlyGist: config.onlyGist,
      onlyRepository: config.onlyRepository,
      dryMode: config.dryMode,
      description: config.description,
      verbose: config.verbose,
    };

    if (options.verbose) {
      console.log('Options:', options);
      console.log('');
    }

    if (options.dryMode) {
      console.log('🔍 DRY MODE - No actual upload will be performed');
      console.log('');
    }

    // Upload the log file
    console.log(
      `${options.dryMode ? '[DRY MODE] Would upload' : 'Uploading'} log file: ${logFile}`
    );
    console.log('');

    const result = await uploadLog(options);

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
      console.log(`Repository: ${result.repositoryName}`);
    }

    console.log('');
    console.log('You can access your uploaded log at:');
    console.log(result.url);

    process.exit(0);
  } catch (error) {
    console.error('');
    console.error('✗ Error:', error.message);

    if (config.verbose) {
      console.error('');
      console.error('Stack trace:');
      console.error(error.stack);
    }

    process.exit(1);
  }
}

// Run the CLI
main();

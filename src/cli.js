#!/usr/bin/env bun

/**
 * gh-upload CLI
 *
 * Command-line interface for uploading files to GitHub
 */

import { makeConfig } from 'lino-arguments';
import { PACKAGE_VERSION } from './package-version.js';
import { resolveRepositoryTarget } from './repository-target.js';
import {
  uploadLog,
  getFileSize,
  formatFileSize,
  fileExists,
  resolveLogFilePath,
  isENOSPC,
  parseFileSize,
  resolveChunkSize,
} from './index.js';

// An omitted private flag must stay undefined; explicit false means public.
function privateDefault(getenv) {
  if (getenv('GH_UPLOAD_PRIVATE', '') !== '') {
    return getenv('GH_UPLOAD_PRIVATE', false);
  }
  return getenv('GH_UPLOAD_LOG_PRIVATE', '') === ''
    ? undefined
    : getenv('GH_UPLOAD_LOG_PRIVATE', false);
}

// Parse command-line arguments with environment variable and .lenv support
const config = makeConfig({
  yargs: ({ yargs, getenv }) =>
    yargs
      .usage('Usage: $0 <file> [options]')
      .command('$0 [logFile]', 'Upload a file to GitHub', (yargs) => {
        yargs.positional('logFile', {
          describe: 'Path to the file to upload',
          type: 'string',
        });
      })
      .option('public', {
        alias: 'p',
        type: 'boolean',
        description: 'Make the upload public (default: private)',
        default: getenv(
          'GH_UPLOAD_PUBLIC',
          getenv('GH_UPLOAD_LOG_PUBLIC', false)
        ),
      })
      .option('private', {
        type: 'boolean',
        description: 'Make the upload private (default)',
        default: privateDefault(getenv),
      })
      .option('auto', {
        type: 'boolean',
        description:
          'Automatically choose upload strategy based on content and file size (default)',
        default: getenv('GH_UPLOAD_AUTO', getenv('GH_UPLOAD_LOG_AUTO', true)),
      })
      .option('only-gist', {
        type: 'boolean',
        description: 'Upload only as GitHub Gist (disables auto mode)',
        default: getenv(
          'GH_UPLOAD_ONLY_GIST',
          getenv('GH_UPLOAD_LOG_ONLY_GIST', false)
        ),
      })
      .option('only-repository', {
        type: 'boolean',
        description: 'Upload only as GitHub Repository (disables auto mode)',
        default: getenv(
          'GH_UPLOAD_ONLY_REPOSITORY',
          getenv('GH_UPLOAD_LOG_ONLY_REPOSITORY', false)
        ),
      })
      .option('shared-repository', {
        type: 'boolean',
        description:
          'Upload repository-mode files into shared private-logs/public-logs repositories (default: true)',
        default: getenv(
          'GH_UPLOAD_SHARED_REPOSITORY',
          getenv('GH_UPLOAD_LOG_SHARED_REPOSITORY', true)
        ),
      })
      .option('repository', {
        type: 'string',
        description:
          'Existing repository target (OWNER/REPO) for repository uploads',
        default:
          getenv(
            'GH_UPLOAD_REPOSITORY',
            getenv('GH_UPLOAD_LOG_REPOSITORY', '')
          ) || undefined,
      })
      .option('branch', {
        type: 'string',
        description:
          'Existing target branch (default: repository default branch); requires --repository',
        default:
          getenv('GH_UPLOAD_BRANCH', getenv('GH_UPLOAD_LOG_BRANCH', '')) ||
          undefined,
      })
      .option('dry-mode', {
        alias: 'dry',
        type: 'boolean',
        description: 'Dry run mode - show what would be done without uploading',
        default: getenv(
          'GH_UPLOAD_DRY_MODE',
          getenv('GH_UPLOAD_LOG_DRY_MODE', false)
        ),
      })
      .option('description', {
        alias: 'd',
        type: 'string',
        description: 'Description for the upload',
        default: getenv(
          'GH_UPLOAD_DESCRIPTION',
          getenv('GH_UPLOAD_LOG_DESCRIPTION', '')
        ),
      })
      .option('verbose', {
        alias: 'v',
        type: 'boolean',
        description: 'Enable verbose output',
        default: getenv(
          'GH_UPLOAD_VERBOSE',
          getenv('GH_UPLOAD_LOG_VERBOSE', false)
        ),
      })
      .option('gist-limit', {
        type: 'string',
        description:
          'Maximum file size uploaded as a gist (e.g. 25MB, 100MB). Larger files use repository mode',
        default: getenv(
          'GH_UPLOAD_GIST_LIMIT',
          getenv('GH_UPLOAD_LOG_GIST_LIMIT', '')
        ),
      })
      .option('chunk-size', {
        type: 'string',
        description:
          'Maximum repository chunk size (e.g. 50MB; default: 100MB)',
        default: getenv(
          'GH_UPLOAD_CHUNK_SIZE',
          getenv('GH_UPLOAD_LOG_CHUNK_SIZE', '')
        ),
      })
      .option('check-raw-url', {
        type: 'boolean',
        description:
          'Verify that the resulting raw URL is reachable before reporting success',
        default: getenv(
          'GH_UPLOAD_CHECK_RAW_URL',
          getenv('GH_UPLOAD_LOG_CHECK_RAW_URL', false)
        ),
      })
      .option('test', {
        alias: 't',
        type: 'boolean',
        description: 'Run self-test to verify upload functionality',
        default: false,
      })
      .option('quick', {
        alias: 'q',
        type: 'boolean',
        description: 'Run quick self-test (only 1MB file)',
        default: false,
      })
      .check((argv) => {
        if (argv.public && argv.private) {
          throw new Error(
            'Arguments public and private are mutually exclusive'
          );
        }
        if (argv.onlyGist && argv.onlyRepository) {
          throw new Error(
            'Arguments only-gist and only-repository are mutually exclusive'
          );
        }
        // Skip validation if running self-test
        if (argv.test || argv.quick) {
          return true;
        }
        resolveRepositoryTarget(argv);
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
        // Validate --gist-limit early so users see the problem before uploading
        if (argv.gistLimit && parseFileSize(argv.gistLimit) === null) {
          throw new Error(
            `Invalid --gist-limit value: ${argv.gistLimit} (expected something like 25MB, 100MB or 1GB)`
          );
        }
        if (argv.chunkSize !== '') {
          try {
            resolveChunkSize(parseFileSize(argv.chunkSize));
          } catch {
            throw new Error(
              `Invalid --chunk-size value: ${argv.chunkSize} (expected 4B through 100MB)`
            );
          }
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
        '$0 ./session.log --only-repository --repository OWNER/REPO --branch feature/logs',
        'Upload to an existing repository branch with an installation token'
      )
      .example(
        '$0 ./large.log --only-repository --public',
        'Upload only as public repository'
      )
      .example(
        '$0 ./large.log --only-repository --no-shared-repository',
        'Use the legacy dedicated repository mode for a large file'
      )
      .example('$0 ./app.log --dry-mode', 'Dry run - show what would be done')
      .example('$0 --test', 'Run self-test to verify functionality')
      .example('$0 --quick', 'Run quick self-test (1MB file only)')
      .help('h')
      .alias('h', 'help')
      .version(PACKAGE_VERSION)
      .strict(),
});

/**
 * Main CLI function
 */
async function main() {
  try {
    // Handle self-test mode
    if (config.test || config.quick) {
      const { runSelfTest } = await import('./self-test.js');
      const result = await runSelfTest({
        verbose: config.verbose,
        quick: config.quick,
      });
      process.exit(result.passed ? 0 : 1);
    }

    const rawLogFile = config.logFile;

    if (!rawLogFile) {
      console.error('❌ Error: Log file path is required');
      console.error('Usage: gh-upload-log <log-file> [options]');
      console.error('Run "gh-upload-log --help" for more information');
      process.exit(1);
    }

    // Resolve relative and home-relative paths up front so every later step
    // (existence check, name generation, git commands) sees the same file.
    const logFile = resolveLogFilePath(rawLogFile);

    if (!fileExists(logFile)) {
      console.error(`❌ Error: File does not exist: ${logFile}`);
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
      useSharedRepository: config.sharedRepository,
      repository: config.repository,
      branch: config.branch,
      dryMode: config.dryMode,
      description: config.description,
      verbose: config.verbose,
      checkRawUrl: config.checkRawUrl,
    };

    if (config.gistLimit) {
      options.gistFileLimit = parseFileSize(config.gistLimit);
    }

    if (config.chunkSize !== '') {
      options.chunkSize = parseFileSize(config.chunkSize);
    }

    if (options.verbose) {
      console.log('Options:', options);
      console.log('');
    }

    // Get file size for display (file existence already verified above)
    const fileSize = getFileSize(logFile);

    // Show concise upload status
    const visibility =
      options.repository && options.onlyRepository
        ? 'existing repository visibility'
        : isPublic
          ? '🌐 public'
          : '🔒 private';
    const dryModePrefix = options.dryMode ? '[DRY] ' : '';

    if (options.verbose) {
      console.log(`📁 ${logFile}`);
      console.log(`📊 ${formatFileSize(fileSize)}`);
      console.log('');
    }

    console.log(
      `${dryModePrefix}⏳ Uploading ${formatFileSize(fileSize)} (${visibility})...`
    );

    const result = await uploadLog(options);

    // Display concise results
    const typeEmoji = result.type === 'gist' ? '📝' : '📦';
    const typeLabel = result.type === 'gist' ? 'Gist' : 'Repository';
    const successEmoji = result.dryMode
      ? '🔍'
      : result.deduplicated
        ? 'ℹ️'
        : '✅';
    const actionLabel = result.dryMode
      ? result.type === 'repo' && options.repository
        ? 'would receive files'
        : 'would be created'
      : result.deduplicated
        ? 'already contains this exact file'
        : result.type === 'repo' && options.repository
          ? 'uploaded'
          : 'created';

    const resultVisibility =
      result.isPublic === null
        ? 'existing repository visibility'
        : result.isPublic
          ? '🌐 public'
          : '🔒 private';
    console.log(
      `${successEmoji} ${typeLabel} ${actionLabel} (${resultVisibility})`
    );

    if (result.url && !result.dryMode) {
      console.log(`🔗 ${result.url}`);
    }

    // Display raw file URL if available (single file only)
    if (result.rawUrl && !result.dryMode) {
      console.log(`📄 ${result.rawUrl}`);
      // Add expiration warning for private repository raw URLs
      if (
        result.type === 'repo' &&
        !result.isPublic &&
        result.rawUrl.includes('?token=')
      ) {
        console.log(
          `⚠️  Note: Raw URL token expires in ~10 minutes for private repositories`
        );
      }
    }

    if (result.rawUrlCheck && !result.rawUrlCheck.ok && !result.dryMode) {
      console.log(
        `⚠️  Raw URL check failed${
          result.rawUrlCheck.status
            ? ` (HTTP ${result.rawUrlCheck.status})`
            : ''
        }${result.rawUrlCheck.error ? `: ${result.rawUrlCheck.error}` : ''}`
      );
      if (result.type === 'repo' && !result.isPublic) {
        console.log(
          '   Private repository raw URLs require a fresh token; use the page URL above instead.'
        );
      }
    }

    // Show additional details only in verbose mode
    if (options.verbose) {
      console.log('');
      console.log('Details:');
      console.log(`  Type: ${typeEmoji} ${typeLabel}`);
      console.log(
        `  Visibility: ${result.isPublic === null ? 'existing repository (not queried in dry mode)' : result.isPublic ? 'public' : 'private'}`
      );
      console.log(
        `  File count: ${result.fileCount || 1}${result.fileCountIsEstimate ? (result.archiveFormat ? ' (estimate before compression)' : ' (minimum estimate before splitting)') : ''}`
      );
      if (result.archiveFormat) {
        console.log(`  Archive: ${result.archiveFormat}`);
        console.log(`  Original file: ${result.originalFileName}`);
      }
      if (result.type === 'gist') {
        console.log(`  File name: ${result.fileName}`);
      } else if (result.type === 'repo') {
        console.log(`  Repository: ${result.repositoryName}`);
        if (result.repositoryFullName) {
          console.log(`  Target: ${result.repositoryFullName}`);
          console.log(
            `  Branch: ${result.branch || 'repository default branch'}`
          );
        }
        if (result.repositoryPath) {
          console.log(`  Path: ${result.repositoryPath}`);
        }
        if (result.contentHash) {
          console.log(`  Content hash: ${result.contentHash}`);
        }
        if (result.fileName) {
          console.log(`  File name: ${result.fileName}`);
        }
        console.log(`  Deduplicated: ${result.deduplicated ? 'yes' : 'no'}`);
      }
      if (result.rawUrl) {
        console.log(`  Raw URL: ${result.rawUrl}`);
      }
      if (result.rawUrlCheck) {
        const status = result.rawUrlCheck.status
          ? ` (HTTP ${result.rawUrlCheck.status})`
          : '';
        const reason = result.rawUrlCheck.error
          ? ` (${result.rawUrlCheck.error})`
          : '';
        console.log(
          `  Raw URL reachable: ${result.rawUrlCheck.ok ? 'yes' : 'no'}${status}${reason}`
        );
      }
    }

    process.exit(0);
  } catch (error) {
    if (isENOSPC(error)) {
      console.error('❌ Error: No space left on device');
      console.error('');
      console.error('Suggestions to free disk space:');
      console.error('  • Check ~/.claude/debug for large debug files');
      console.error('  • Clean /tmp directory: rm -rf /tmp/log-*');
      console.error('  • Check disk usage: df -h && du -sh /tmp ~/.claude');
      if (error.message && error.message.includes('--only-gist')) {
        console.error('');
        console.error(
          '💡 Hint: This file fits in a gist. Try --only-gist to upload'
        );
        console.error('   without requiring temporary disk space.');
      }
    } else {
      console.error('❌ Error:', error.message);
    }

    if (config.verbose) {
      console.error('');
      console.error('Stack trace:');
      console.error(error.stack);
      if (error.originalError) {
        console.error('');
        console.error('Original error:');
        console.error(error.originalError.stack || error.originalError.message);
      }
    }

    process.exit(1);
  }
}

// Run the CLI
main();

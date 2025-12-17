# gh-upload-log

A smart tool to upload log files to GitHub as Gists or Repositories

[![License: Unlicense](https://img.shields.io/badge/license-Unlicense-blue.svg)](http://unlicense.org/)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)

## Overview

`gh-upload-log` is a CLI tool and JavaScript library that intelligently uploads log files to GitHub. It automatically determines the best upload strategy based on file size:

- **Small files (≤100MB)**: Uploaded as GitHub Gists
- **Large files (>100MB)**: Uploaded as GitHub Repositories with automatic splitting into 100MB chunks

## Features

- **Automatic strategy selection**: Chooses between Gist and Repository based on file size
- **Smart file splitting**: Automatically splits large files into manageable chunks
- **Public/Private control**: Upload as public or private (default: private)
- **Flexible configuration**: CLI arguments, environment variables, or `.lenv` files using [Links Notation](https://github.com/link-foundation/links-notation)
- **Cross-platform**: Works on macOS, Linux, and Windows
- **Dual interface**: Use as CLI tool or JavaScript library
- **Path normalization**: Converts file paths into valid GitHub names
- **Verbose logging**: Built-in verbose mode using [log-lazy](https://github.com/link-foundation/log-lazy) for efficient lazy evaluation
- **Configurable logging**: Customize logging behavior with custom log targets (silent mode, custom loggers, etc.)

## Prerequisites

- Node.js ≥20.0.0
- Git (installed and configured)
- GitHub CLI (`gh`) installed and authenticated

To authenticate with GitHub CLI:

```bash
gh auth login
```

## Installation

### Global Installation (CLI)

```bash
npm install -g gh-upload-log
```

### Local Installation (Library)

```bash
npm install gh-upload-log
```

## Configuration

`gh-upload-log` supports multiple configuration methods with the following priority (highest to lowest):

1. **CLI arguments** - Directly passed command-line options
2. **Environment variables** - System environment variables
3. **`.lenv` file** - Local configuration using Links Notation format
4. **Defaults** - Built-in default values

### Using .lenv Configuration Files

The tool now supports `.lenv` configuration files using [Links Notation](https://github.com/link-foundation/links-notation) format through [lino-arguments](https://github.com/link-foundation/lino-arguments).

Create a `.lenv` file in your project directory:

```
GH_UPLOAD_LOG_PUBLIC: false
GH_UPLOAD_LOG_VERBOSE: true
GH_UPLOAD_LOG_DESCRIPTION: Production logs
```

The configuration priority is:

1. CLI arguments (highest priority)
2. Environment variables
3. `.lenv` file
4. Default values (lowest priority)

You can also specify a custom configuration file using the `--configuration` or `-c` flag:

```bash
gh-upload-log /path/to/file.log --configuration ./custom.lenv
```

### Using Environment Variables

Set environment variables for persistent configuration:

```bash
export GH_UPLOAD_LOG_PUBLIC=true
export GH_UPLOAD_LOG_VERBOSE=true
export GH_UPLOAD_LOG_DESCRIPTION="Production logs"
gh-upload-log /var/log/app.log
```

### Available Configuration Options

- `GH_UPLOAD_LOG_PUBLIC` - Make uploads public (default: false)
- `GH_UPLOAD_LOG_PRIVATE` - Make uploads private (default: true)
- `GH_UPLOAD_LOG_AUTO` - Enable automatic strategy selection (default: true)
- `GH_UPLOAD_LOG_ONLY_GIST` - Force gist uploads only (default: false)
- `GH_UPLOAD_LOG_ONLY_REPOSITORY` - Force repository uploads only (default: false)
- `GH_UPLOAD_LOG_DRY_MODE` - Enable dry run mode (default: false)
- `GH_UPLOAD_LOG_DESCRIPTION` - Default description for uploads
- `GH_UPLOAD_LOG_VERBOSE` - Enable verbose output (default: false)

See [.lenv.example](./.lenv.example) for a complete configuration template.

## CLI Usage

### Basic Usage

```bash
# Upload a log file (private by default)
gh-upload-log /path/to/logfile.log

# Upload as public
gh-upload-log /path/to/logfile.log --public

# Upload with description
gh-upload-log /path/to/logfile.log --description "My application logs"
```

### CLI Options

```
Usage: gh-upload-log <log-file> [options]

Options:
  --public, -p         Make the upload public (default: private)
  --private            Make the upload private (default)
  --auto               Automatically choose upload strategy (default: true)
  --only-gist          Upload only as GitHub Gist (disables auto mode)
  --only-repository    Upload only as GitHub Repository (disables auto mode)
  --dry-mode, --dry    Dry run - show what would be done without uploading
  --description, -d    Description for the upload
  --verbose, -v        Enable verbose output
  --help, -h           Show help
  --version            Show version number
```

### CLI Examples

```bash
# Upload private log file (auto mode)
gh-upload-log /var/log/app.log

# Upload public log file (auto mode)
gh-upload-log /var/log/app.log --public

# Upload only as gist
gh-upload-log ./error.log --only-gist

# Upload only as repository
gh-upload-log ./large.log --only-repository --public

# Dry run mode - see what would happen
gh-upload-log ./app.log --dry-mode

# Upload with custom description
gh-upload-log ./debug.log -d "Debug logs from production" --public

# Disable auto mode and force repository
gh-upload-log ./file.log --no-auto --only-repository
```

## Library Usage

### Basic Example

```javascript
import { uploadLog } from 'gh-upload-log';

// Upload a log file (private by default)
const result = await uploadLog({
  filePath: '/path/to/logfile.log',
});
console.log('Uploaded to:', result.url);

// Upload as public with verbose logging
const publicResult = await uploadLog({
  filePath: '/path/to/logfile.log',
  isPublic: true,
  description: 'My application logs',
  verbose: true,
});
console.log('Public URL:', publicResult.url);

// Upload with custom logger (silent mode)
const customLogger = {
  log: () => {}, // Silent logging
  error: (msg) => console.error('ERROR:', msg),
};

const result = await uploadLog({
  filePath: '/path/to/logfile.log',
  logger: customLogger,
});
```

### API Reference

#### `uploadLog(options)`

Main function to upload a log file. Automatically determines the best strategy.

**Parameters:**

- `options` (object):
  - `filePath` (string, **required**): Path to the log file
  - `isPublic` (boolean): Make upload public (default: false)
  - `auto` (boolean): Automatically choose strategy (default: true)
  - `onlyGist` (boolean): Upload only as gist (disables auto mode)
  - `onlyRepository` (boolean): Upload only as repository (disables auto mode)
  - `dryMode` (boolean): Dry run mode - don't actually upload
  - `description` (string): Description for the upload
  - `verbose` (boolean): Enable verbose logging (default: false)
  - `logger` (object): Custom logging target (default: console)

**Returns:** Promise<Object>

```javascript
{
  type: 'gist' | 'repo',
  url: string,
  isPublic: boolean,
  fileName?: string,           // For gists
  repositoryName?: string,     // For repos
  dryMode?: boolean            // Set to true in dry mode
}
```

#### `uploadAsGist(options)`

Upload a file as a GitHub Gist.

**Parameters:**

- `options` (object):
  - `filePath` (string, **required**): Path to the file
  - `isPublic` (boolean): Make gist public (default: false)
  - `description` (string): Gist description
  - `verbose` (boolean): Enable verbose logging (default: false)
  - `logger` (object): Custom logging target (default: console)

**Returns:** Promise<Object>

#### `uploadAsRepo(options)`

Upload a file as a GitHub Repository (with splitting if needed).

**Parameters:**

- `options` (object):
  - `filePath` (string, **required**): Path to the file
  - `isPublic` (boolean): Make repo public (default: false)
  - `description` (string): Repository description
  - `verbose` (boolean): Enable verbose logging (default: false)
  - `logger` (object): Custom logging target (default: console)

**Returns:** Promise<Object>

#### `determineUploadStrategy(filePath)`

Determine the best upload strategy for a file.

**Parameters:**

- `filePath` (string): Path to the file

**Returns:** Object

```javascript
{
  type: 'gist' | 'repo',
  fileSize: number,
  needsSplit: boolean,
  numChunks?: number,    // For repos
  reason: string
}
```

#### Utility Functions

- `normalizeFileName(filePath)`: Convert file path to GitHub-safe name
- `generateRepoName(filePath)`: Generate repository name (with `log-` prefix)
- `generateGistFileName(filePath)`: Generate gist file name
- `fileExists(filePath)`: Check if file exists
- `getFileSize(filePath)`: Get file size in bytes

### Constants

```javascript
import {
  GITHUB_GIST_FILE_LIMIT, // 100 MB
  GITHUB_GIST_WEB_LIMIT, // 25 MB
  GITHUB_REPO_CHUNK_SIZE, // 100 MB
} from 'gh-upload-log';
```

## How It Works

### File Naming

File paths are normalized for GitHub compatibility:

- Leading slashes are removed
- All `/` characters are replaced with `-`
- Repository names are prefixed with `log-`

Examples:

- `/home/user/app.log` → Gist: `home-user-app.log`, Repo: `log-home-user-app`
- `./logs/error.log` → Gist: `.-logs-error.log`, Repo: `log-.-logs-error`

### Upload Strategy

1. **Files ≤100MB**: Uploaded as GitHub Gist
   - Single file upload
   - Fast and efficient
   - Viewable directly in browser

2. **Files >100MB**: Uploaded as GitHub Repository
   - File is split into 100MB chunks
   - Each chunk is committed to the repo
   - Original file structure is preserved

### Privacy

By default, all uploads are **private**:

- **Private Gists**: Only accessible by you
- **Private Repositories**: Only accessible by you

Use `--public` flag or `isPublic: true` option for public uploads.

## GitHub Limits

- **Gist file limit**: 100 MB (via git), 25 MB (via web interface)
- **Repository size**: No strict limit, but large repos may have performance issues
- **Chunk size**: Files are split into 100 MB chunks for repositories

## Testing

Run tests using your preferred runtime:

```bash
# Node.js
npm test

# Bun
bun test

# Deno
deno test --allow-all
```

## Examples

See the `examples/` directory for more usage examples:

- `examples/basic-usage.js`: Basic library usage
- `examples/library-api.js`: API function examples

Run examples:

```bash
node examples/library-api.js
```

## Development

### Project Structure

```
gh-upload-log/
├── src/
│   ├── index.js          # Core library
│   └── cli.js            # CLI interface
├── test/
│   └── index.test.js     # Tests
├── examples/
│   ├── basic-usage.js
│   └── library-api.js
├── package.json
└── README.md
```

### Dependencies

This project uses modern Link Foundation libraries:

- **[lino-arguments](https://github.com/link-foundation/lino-arguments)**: CLI argument parsing with environment variable and .lenv file support
- **[log-lazy](https://github.com/link-foundation/log-lazy)**: Efficient lazy evaluation logging
- **[use-m](https://github.com/link-foundation/use-m)**: Dynamic module loading without package.json pollution
- **[command-stream](https://github.com/link-foundation/command-stream)**: Streamable command execution
- **[test-anywhere](https://github.com/link-foundation/test-anywhere)**: Universal testing framework (dev dependency)

The following libraries are used internally by lino-arguments:

- **[lino-env](https://github.com/link-foundation/lino-env)**: Configuration management using Links Notation format
- **[links-notation](https://github.com/link-foundation/links-notation)**: Data description using references and links
- **[yargs](https://yargs.js.org/)**: Command-line argument parsing

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This is free and unencumbered software released into the public domain. See [LICENSE](LICENSE) for details.

## Links

- GitHub Repository: https://github.com/link-foundation/gh-upload-log
- Issue Tracker: https://github.com/link-foundation/gh-upload-log/issues
- Link Foundation: https://github.com/link-foundation

## Related Projects

- [lino-arguments](https://github.com/link-foundation/lino-arguments) - CLI argument parsing with environment variables and .lenv support
- [lino-env](https://github.com/link-foundation/lino-env) - Configuration management using Links Notation
- [links-notation](https://github.com/link-foundation/links-notation) - Data description using references and links
- [log-lazy](https://github.com/link-foundation/log-lazy) - Efficient lazy evaluation logging
- [use-m](https://github.com/link-foundation/use-m) - Dynamic module loading
- [command-stream](https://github.com/link-foundation/command-stream) - Streamable commands
- [test-anywhere](https://github.com/link-foundation/test-anywhere) - Universal testing

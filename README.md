# gh-upload-log

A smart tool to upload log files to GitHub as Gists or Repositories

[![License: Unlicense](https://img.shields.io/badge/license-Unlicense-blue.svg)](http://unlicense.org/)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

## Overview

`gh-upload-log` is a CLI tool and JavaScript library that intelligently uploads log files to GitHub. It automatically determines the best upload strategy based on file size:

- **Small files (≤100MB)**: Uploaded as GitHub Gists
- **Large files (>100MB)**: Uploaded as GitHub Repositories with automatic splitting into 100MB chunks

## Features

- **Automatic strategy selection**: Chooses between Gist and Repository based on file size
- **Smart file splitting**: Automatically splits large files into manageable chunks
- **Public/Private control**: Upload as public or private (default: private)
- **Cross-platform**: Works on macOS, Linux, and Windows
- **Dual interface**: Use as CLI tool or JavaScript library
- **Path normalization**: Converts file paths into valid GitHub names

## Prerequisites

- Node.js ≥18.0.0
- Git (installed and configured)
- GitHub CLI (`gh`) installed and authenticated

To authenticate with GitHub CLI:
```bash
gh auth login
```

## Installation

### Global Installation (CLI)

```bash
npm install -g @link-foundation/gh-upload-log
```

### Local Installation (Library)

```bash
npm install @link-foundation/gh-upload-log
```

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
  --public, -p       Make the upload public (default: private)
  --private          Make the upload private (default)
  --force-gist       Force upload as GitHub Gist
  --force-repo       Force upload as GitHub Repository
  --description, -d  Description for the upload
  --verbose, -v      Enable verbose output
  --help, -h         Show help
  --version          Show version number
```

### CLI Examples

```bash
# Upload private log file
gh-upload-log /var/log/app.log

# Upload public log file
gh-upload-log /var/log/app.log --public

# Force upload as gist
gh-upload-log ./error.log --force-gist

# Force upload as repository
gh-upload-log ./large.log --force-repo --public

# Upload with custom description
gh-upload-log ./debug.log -d "Debug logs from production" --public
```

## Library Usage

### Basic Example

```javascript
import { uploadLog } from '@link-foundation/gh-upload-log';

// Upload a log file (private by default)
const result = await uploadLog('/path/to/logfile.log');
console.log('Uploaded to:', result.url);

// Upload as public
const publicResult = await uploadLog('/path/to/logfile.log', {
  isPublic: true,
  description: 'My application logs'
});
console.log('Public URL:', publicResult.url);
```

### API Reference

#### `uploadLog(filePath, options)`

Main function to upload a log file. Automatically determines the best strategy.

**Parameters:**
- `filePath` (string): Path to the log file
- `options` (object, optional):
  - `isPublic` (boolean): Make upload public (default: false)
  - `forceGist` (boolean): Force upload as gist (default: false)
  - `forceRepo` (boolean): Force upload as repository (default: false)
  - `description` (string): Description for the upload

**Returns:** Promise<Object>
```javascript
{
  type: 'gist' | 'repo',
  url: string,
  isPublic: boolean,
  fileName?: string,      // For gists
  repoName?: string       // For repos
}
```

#### `uploadAsGist(filePath, options)`

Upload a file as a GitHub Gist.

**Parameters:**
- `filePath` (string): Path to the file
- `options` (object, optional):
  - `isPublic` (boolean): Make gist public (default: false)
  - `description` (string): Gist description

**Returns:** Promise<Object>

#### `uploadAsRepo(filePath, options)`

Upload a file as a GitHub Repository (with splitting if needed).

**Parameters:**
- `filePath` (string): Path to the file
- `options` (object, optional):
  - `isPublic` (boolean): Make repo public (default: false)
  - `description` (string): Repository description

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
  GITHUB_GIST_FILE_LIMIT,     // 100 MB
  GITHUB_GIST_WEB_LIMIT,      // 25 MB
  GITHUB_REPO_CHUNK_SIZE      // 100 MB
} from '@link-foundation/gh-upload-log';
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
- **use-m**: Dynamic module loading without package.json pollution
- **command-stream**: Streamable command execution
- **yargs**: Command-line argument parsing
- **test-anywhere**: Universal testing framework

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This is free and unencumbered software released into the public domain. See [LICENSE](LICENSE) for details.

## Links

- GitHub Repository: https://github.com/link-foundation/gh-upload-log
- Issue Tracker: https://github.com/link-foundation/gh-upload-log/issues
- Link Foundation: https://github.com/link-foundation

## Related Projects

- [use-m](https://github.com/link-foundation/use-m) - Dynamic module loading
- [command-stream](https://github.com/link-foundation/command-stream) - Streamable commands
- [test-anywhere](https://github.com/link-foundation/test-anywhere) - Universal testing

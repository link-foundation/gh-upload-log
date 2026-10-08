# gh-upload-log

A smart tool to upload log files to GitHub as Gists or Repositories

[![npm version](https://img.shields.io/npm/v/gh-upload-log.svg)](https://www.npmjs.com/package/gh-upload-log)
[![License: Unlicense](https://img.shields.io/badge/license-Unlicense-blue.svg)](http://unlicense.org/)
[![Bun](https://img.shields.io/badge/Bun-%E2%89%A51.0.0-f9f1e1.svg)](https://bun.sh/)

## Overview

`gh-upload-log` is a CLI tool and JavaScript library that intelligently uploads log files to GitHub. It automatically determines the best upload strategy based on file size:

- **Small files (≤25MB)**: Uploaded as GitHub Gists
- **Large files (>25MB)**: Uploaded as GitHub Repositories
- **Very large files (>100MB)**: Split into readable chunks of at most 100MB before repository upload

## Features

- **Automatic strategy selection**: Chooses between Gist and Repository based on file size
- **Shared repository uploads by default**: Repository-mode files go into `private-logs` or `public-logs`
- **Content-addressed versions**: Repository-mode logs are stored under `<directory>/<content-hash>/<file-name>.log.txt`, so every version of the same path is kept
- **Duplicate protection**: Re-uploading unchanged content reuses the existing file, while changed content is always uploaded again
- **Smart file splitting**: Automatically splits large files into manageable chunks
- **Public/Private control**: Upload as public or private (default: private)
- **Flexible configuration**: CLI arguments, environment variables, or `.lenv` files using [Links Notation](https://github.com/link-foundation/links-notation)
- **Cross-platform**: Works on macOS, Linux, and Windows
- **Dual interface**: Use as CLI tool or JavaScript library
- **Path normalization**: Accepts relative, `./`, `../`, `~/` and absolute paths, and converts them into valid GitHub names
- **Verbose logging**: Built-in verbose mode using [log-lazy](https://github.com/link-foundation/log-lazy) for efficient lazy evaluation
- **Configurable logging**: Customize logging behavior with custom log targets (silent mode, custom loggers, etc.)

## Prerequisites

- [Bun](https://bun.sh/) ≥1.0.0
- Git (installed and configured)
- GitHub CLI (`gh`) installed and authenticated

To authenticate with GitHub CLI:

```bash
gh auth login
```

## Installation

### Global Installation (CLI)

```bash
bun install -g gh-upload-log
```

### Local Installation (Library)

```bash
bun add gh-upload-log
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
GH_UPLOAD_LOG_SHARED_REPOSITORY: true
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
export GH_UPLOAD_LOG_SHARED_REPOSITORY=true
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
- `GH_UPLOAD_LOG_SHARED_REPOSITORY` - Use shared `private-logs` / `public-logs` repositories for repository-mode uploads (default: true)
- `GH_UPLOAD_LOG_REPOSITORY` - Explicit existing repository target in `OWNER/REPO` format for repository-mode uploads
- `GH_UPLOAD_LOG_BRANCH` - Existing branch in that target (default: its default branch; requires `GH_UPLOAD_LOG_REPOSITORY` or `--repository`)
- `GH_UPLOAD_LOG_DRY_MODE` - Enable dry run mode (default: false)
- `GH_UPLOAD_LOG_DESCRIPTION` - Default description for uploads
- `GH_UPLOAD_LOG_VERBOSE` - Enable verbose output (default: false)
- `GH_UPLOAD_LOG_GIST_LIMIT` - Maximum file size uploaded as a gist, e.g. `25MB` (default: 25MB, clamped to GitHub's documented 100MB limit)
- `GH_UPLOAD_LOG_CHUNK_SIZE` - Maximum repository chunk size, e.g. `50MB` (default: 100MB; accepts 4B through 100MB)
- `GH_UPLOAD_LOG_CHECK_RAW_URL` - Verify that the resulting raw URL is reachable (default: false)

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
  --shared-repository  Upload repository-mode logs into shared
                       private-logs/public-logs repositories (default: true)
  --repository         Existing repository target in OWNER/REPO format
  --branch             Existing target branch (default: its default branch);
                       requires --repository
  --dry-mode, --dry    Dry run - show what would be done without uploading
  --description, -d    Description for the upload
  --verbose, -v        Enable verbose output
  --gist-limit         Maximum file size uploaded as a gist (e.g. 25MB, 100MB).
                       Larger files use repository mode (default: 25MB)
  --chunk-size         Maximum repository chunk size (e.g. 50MB; default: 100MB)
  --check-raw-url      Verify that the resulting raw URL is reachable
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

# Use the legacy dedicated repository mode
gh-upload-log ./large.log --only-repository --no-shared-repository

# Upload directly to an existing repository branch
gh-upload-log ./session.log --only-repository --repository OWNER/REPO --branch feature/logs

# Dry run mode - see what would happen
gh-upload-log ./app.log --dry-mode

# Upload with custom description
gh-upload-log ./debug.log -d "Debug logs from production" --public

# Disable auto mode and force repository
gh-upload-log ./file.log --no-auto --only-repository

# Raise the gist threshold (GitHub documents 100MB per gist file)
gh-upload-log ./big.log --gist-limit 100MB

# Verify that the produced raw URL really works
gh-upload-log ./app.log --check-raw-url --verbose
```

### Reliable large log uploads

For slow or proxied connections, use smaller repository chunks:

```bash
gh-upload-log ./session.log --only-repository --public --chunk-size 50MB
# Or set GH_UPLOAD_LOG_CHUNK_SIZE=50MB in your environment or .lenv
```

Shared-repository uploads commit and push one chunk at a time. Transient HTTP
408/429/5xx, RPC failures, connection drops, and concurrent push rejections get
up to two retries, after 1 and 2 seconds. Each retry fetches and rebases onto the
latest remote branch. Authentication, permission, and file-size failures stop
immediately. Use `--verbose` to see chunk progress and retry details.

An interrupted upload keeps the chunks already pushed. Uploading the same log
again skips chunks that match the remote. A hidden `.pending` file marks the
upload in progress and a `.complete` file replaces it
with the last chunk, so incomplete folders are never treated as complete uploads.
Complete legacy chunked uploads without a pending marker are recognized by their
total byte size. Pending uploads are resumed even when changing the chunk size
has left a mixture of old and new parts.

Chunks end at line boundaries where possible and preserve the original bytes.
A line longer than the configured limit is split between UTF-8 characters to keep
each chunk within the limit. CRLF and a missing final newline are preserved.
The number of chunks shown before upload is a minimum estimate; line boundaries
can produce additional chunks. Smaller chunks do not change the gist threshold.

The legacy dedicated-repository mode supports the chunk size and readable
splitting options, but still creates its repository with a single initial push.

### Existing repositories and GitHub App installation tokens

Select an existing repository and branch when your token can write to that
repository but cannot access Gists or `GET /user`:

```bash
# Explicitly select the current Actions repository and an existing branch
gh-upload-log ./session.log --only-repository \
  --repository "$GITHUB_REPOSITORY" --branch "$LOG_UPLOAD_BRANCH"

# Auto mode tries Gists first and falls back to the selected repository
gh-upload-log ./session.log --auto --repository OWNER/REPO --branch feature/logs
```

Authenticate `gh` with your installation token (for example, through `GH_TOKEN`).
The token needs access to the repository and `Contents: write`; branch rules still
apply. Repository mode checks `GET /repos/OWNER/REPO`, derives the owner from the
target, and skips both the authenticated-user lookup and repository creation.
The temporary checkout uses `gh` for Git credentials and a local `gh-upload-log`
commit identity, without changing your checkout or global Git configuration.

Both the repository and branch must already exist. Omit `--branch` to use the
repository's default branch. Reads for deduplication and raw URLs, fetches, and
pushes all use the selected branch. Logs keep the same content-addressed layout
and chunk retry/resume behavior as shared-repository uploads.

`--repository` overrides `--shared-repository` for repository-mode uploads.
The existing target's visibility determines the repository result;
`--public`/`--private` still control Gists and newly created personal repositories.
Dry mode makes no GitHub requests, so the target's visibility and an omitted
branch remain unknown (`isPublic: null`, `branch: null`).

`GITHUB_REPOSITORY` is used only when explicitly passed as shown above.
You can also configure `GH_UPLOAD_LOG_REPOSITORY` and `GH_UPLOAD_LOG_BRANCH` in
your environment or `.lenv`. Without an explicit target, personal shared and
dedicated repository uploads retain their authenticated-user behavior.

Gist permission errors such as `Resource not accessible by integration` stop
without retrying and trigger repository fallback in auto mode. Rate-limit
errors remain retryable, with waits of 60 and 120 seconds by default before
fallback; `--only-gist` reports the failure instead of falling back.

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
  - `useSharedRepository` (boolean): Use shared `private-logs` / `public-logs` repositories for repository-mode uploads (default: true)
  - `repository` (string): Explicit existing repository in `OWNER/REPO` format for repository mode and Gist fallback; overrides `useSharedRepository`
  - `branch` (string): Existing target branch (default: repository default branch); requires `repository`
  - `dryMode` (boolean): Dry run mode - don't actually upload
  - `description` (string): Description for the upload
  - `verbose` (boolean): Enable verbose logging (default: false)
  - `logger` (object): Custom logging target (default: console)

**Returns:** Promise<Object>

```javascript
{
  type: 'gist' | 'repo',
  url: string,
  rawUrl?: string | null,
  isPublic: boolean | null,   // null for an explicit repository target in dry mode
  fileCount?: number,
  fileName?: string,           // For gists
  repositoryName?: string,     // For repos
  repositoryFullName?: string, // OWNER/REPO for shared/explicit targets
  branch?: string | null,      // Shared/explicit target branch; null if unknown in dry mode
  repositoryPath?: string,     // Shared repository folder for repository-mode uploads
  deduplicated?: boolean,      // True when an existing shared-repo upload was reused
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

Upload a file as a GitHub Repository. Repository-mode uploads use the shared
`private-logs` / `public-logs` repositories by default. Set
`useSharedRepository: false` to keep the legacy dedicated-repository behavior.

**Parameters:**

- `options` (object):
  - `filePath` (string, **required**): Path to the file
  - `isPublic` (boolean): Make repo public (default: false)
  - `useSharedRepository` (boolean): Use shared repositories for repository-mode uploads (default: true)
  - `repository` (string): Explicit existing `OWNER/REPO` target; bypasses user lookup and repository creation
  - `branch` (string): Existing branch in that repository (default: its default branch); requires `repository`
  - `chunkSize` (number): Maximum chunk size in bytes (default: `100 * 1024 * 1024`; accepts 4 bytes through 100MB)
  - `pushRetries` (number): Extra shared-repository push attempts (default: 2; accepts 0 through 10)
  - `pushRetryDelayMs` (number): Initial retry delay in milliseconds, doubled for each retry and capped at 30000 (default: 1000)
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

- `resolveLogFilePath(filePath)`: Resolve a relative, `./`, `../` or `~/` path to an absolute path
- `normalizeFileName(filePath)`: Convert file path to GitHub-safe name
- `generateRepoName(filePath)`: Generate repository name (with `log-` prefix)
- `generateUploadedLogFileName(filePath)`: Generate the legacy flattened `.log.txt` file name
- `generateStoredLogFileName(filePath)`: Generate the stored `.log.txt` file name (base name only)
- `generateLogDirectorySegment(filePath)`: Generate the normalized directory folder name
- `generateFileContentHash(filePath)`: Compute the truncated SHA-256 content hash (async)
- `buildLogRepositoryPath(filePath, contentHash)`: Build the `<directory>/<hash>` repository path
- `checkRawUrlExists(rawUrl)`: Check whether a raw URL is reachable (async)
- `parseFileSize(value)`: Parse `25MB`, `1.5GB`, `1024B` (plain numbers are megabytes)
- `generateGistFileName(filePath)`: Generate gist file name
- `fileExists(filePath)`: Check if file exists
- `getFileSize(filePath)`: Get file size in bytes

### Constants

```javascript
import {
  GITHUB_GIST_FILE_LIMIT, // 25 MB (default threshold)
  GITHUB_GIST_WEB_LIMIT, // 25 MB (github.com upload form)
  GITHUB_GIST_DOCUMENTED_FILE_LIMIT, // 100 MB (documented API maximum)
  GITHUB_REPO_CHUNK_SIZE, // 100 MB
  LOG_CONTENT_HASH_LENGTH, // 16 hex characters
} from 'gh-upload-log';
```

## How It Works

### File Naming

Every accepted path form — `app.log`, `./app.log`, `../logs/app.log`,
`~/app.log` and `/home/user/app.log` — is first resolved to an absolute path,
so the same file always produces the same names no matter how it was spelled.
The absolute path is then normalized for GitHub compatibility:

- Leading slashes (and a Windows drive colon) are removed
- All `/` characters are replaced with `-`
- Uploaded log files use `.log.txt` so raw file links open as text in browsers
- Very long names are shortened deterministically with a short hash prefix to
  stay within GitHub's 100-character repository name limit and the 255-byte
  path component limit

### Repository layout

Repository-mode uploads are content addressed. The directory of the log becomes
a folder, the first 16 hex characters of the file's SHA-256 become a sub-folder,
and the file keeps its own name:

```
<normalized-directory>/<content-hash>/<file-name>.log.txt
```

Examples (run from `/home/user`):

- `/home/box/hive-telegram-bot.log` → `home-box/8f14e45fceea167a/hive-telegram-bot.log.txt`
- `/home/user/app.log` → `home-user/<hash>/app.log.txt`
- `./logs/error.log` → `home-user-logs/<hash>/error.log.txt`

Because the hash is part of the path, every version of the same log file is
kept side by side and a changed file is always uploaded again. Uploading the
exact same bytes twice reuses the existing file instead of pushing a duplicate.

Gist file names still use the flattened `home-user-app.log.txt` form, and the
legacy dedicated-repository mode still names the repository `log-home-user-app`
(with the same hashed folder inside).

### Upload Strategy

1. **Files ≤25MB**: Uploaded as GitHub Gist
   - Single file upload
   - Fast and efficient
   - Viewable directly in browser
   - If gist creation fails in auto mode, repository fallback uses the shared `private-logs` or `public-logs` repository by default

2. **Files >25MB**: Uploaded as GitHub Repository
   - By default, uploads go into the shared `private-logs` or `public-logs` repository
   - The old dedicated-repository flow is still available with `--no-shared-repository` or `useSharedRepository: false`
   - Re-uploading identical content reuses the existing file; changed content is uploaded into a new content-hash folder
   - The threshold can be raised with `--gist-limit` (up to GitHub's documented 100MB gist limit)

3. **Files >100MB**: Uploaded as a chunked GitHub Repository folder
   - File is split into chunks of at most 100MB (configurable with `--chunk-size`)
   - Each chunk is committed and pushed separately to the shared repository target
   - Original file structure is preserved inside the repository folder

### Privacy

By default, all uploads are **private**:

- **Private Gists**: Only accessible by you
- **Private Repositories**: Only accessible by you

Use `--public` flag or `isPublic: true` option for public uploads.

### Raw URLs

Raw URLs of **private** repositories carry a short-lived `?token=` parameter and
return `404` once it expires (and also when it is stripped). This is GitHub
behavior, not a missing file — use the repository page URL for a permanent link,
or make the upload public. Pass `--check-raw-url` to verify reachability right
after the upload.

## GitHub Limits

- **Default gist threshold**: 25 MB (configurable with `--gist-limit`)
- **Documented gist file limit**: 100 MB (measured: uploads up to 102 MB succeeded, ≥104 MB returned HTTP 502; see [docs/case-studies/issue-38](./docs/case-studies/issue-38/README.md))
- **github.com gist upload form limit**: 25 MB
- **Repository-mode threshold**: Files larger than the gist threshold switch to repository uploads
- **Repository size**: No strict limit, but large repos may have performance issues
- **Chunk size**: Repository chunks default to at most 100 MB; configure a smaller limit with `--chunk-size`

## Testing

Run tests using Bun:

```bash
bun test
```

## Examples

See the `examples/` directory for more usage examples:

- `examples/basic-usage.js`: Basic library usage
- `examples/library-api.js`: API function examples
- `examples/changed-file-reupload.js`: How a growing log file is uploaded again (issue #38)

Run examples:

```bash
bun examples/library-api.js
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

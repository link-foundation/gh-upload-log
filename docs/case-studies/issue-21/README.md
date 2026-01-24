# Case Study: Issue #21 - Direct Link to Single Log File in Repository or Gist

## Summary

When uploading a single log file to GitHub (either as a gist or repository), the tool should provide a direct link to the raw file content in addition to the main repository/gist URL. This enables easier sharing and direct access to the log content.

## Issue Details

**Issue URL**: https://github.com/link-foundation/gh-upload-log/issues/21
**Title**: If we have only one log part in repository or gist we should give direct link to it (in addition to gist/repository link)
**Reporter**: konard
**Date Reported**: 2026-01-24
**Labels**: bug, documentation, enhancement

## Problem Description

When a user uploads a single log file using `gh-upload-log`, the current output only provides the repository or gist URL:

```
✅ Repository created (🔒 private)
🔗 https://github.com/konard/log-home-hive-b97bb9ff-68e7-441e-8441-832bab47c634
```

The user needs to navigate to the repository/gist, find the file, and click "Raw" to get a direct link. The raw link includes a token that makes it shareable even for private repositories:

```
https://raw.githubusercontent.com/konard/log-home-hive-b97bb9ff-68e7-441e-8441-832bab47c634/refs/heads/main/home-hive-b97bb9ff-68e7-441e-8441-832bab47c634.log?token=GHSAT0AAAAAACVDCR4EC5CCMJV6LDQK7NCU2LVBB5Q
```

## Timeline / Sequence of Events

1. **2026-01-24 18:10**: User reported issue #21 requesting direct file links
2. **2026-01-24 18:13**: Investigation began to understand GitHub's raw URL mechanisms
3. **2026-01-24 18:14**: Research conducted on GitHub API for raw file URLs

## Research Findings

### GitHub Gist Raw URLs

For gists (both secret and public), the GitHub API provides a `raw_url` field for each file:

```json
{
  "files": {
    "test-file.log": {
      "filename": "test-file.log",
      "raw_url": "https://gist.githubusercontent.com/user/gist-id/raw/hash/test-file.log",
      "size": 33
    }
  }
}
```

**Key Finding**: Secret gists' raw URLs are accessible without authentication. "Secret" gists are unlisted, not truly private - anyone with the URL can access them.

### GitHub Repository Raw URLs

For repositories (public or private), the GitHub API provides a `download_url` field:

```json
{
  "download_url": "https://raw.githubusercontent.com/owner/repo/main/file.log?token=TOKEN",
  "html_url": "https://github.com/owner/repo/blob/main/file.log"
}
```

**Key Findings**:
1. **Private repos**: The `download_url` includes a token that enables unauthenticated access
2. **Token expiration**: These tokens expire after approximately 10 minutes (per GitHub documentation)
3. **Token regeneration**: Each API call to get the file content generates a fresh token

### Token Expiration Issue

According to [GitHub Community Discussion #23845](https://github.com/orgs/community/discussions/23845):

> "If you get a raw link by clicking 'raw' in your repository, you get a link which will expire in 10 minutes."

This means private repository raw URLs with tokens are **not suitable for long-term sharing**.

### Alternative Access Methods

For permanent access to private repository files, users need:
1. A Personal Access Token (PAT) with `repo` scope
2. Use the token in an Authorization header when making requests

## Root Cause Analysis

### Current Implementation Gaps

The current `uploadAsGist()` and `uploadAsRepo()` functions in `src/index.js`:

1. **Gist upload**: Returns only the gist URL, not the individual file's raw URL
2. **Repository upload**: Returns only the repository URL, not the file's `download_url`

### Technical Analysis

**For Gists** (`uploadAsGist`, lines 226-281):
```javascript
// Current: Returns gist URL from gh CLI output
const gistUrl = result.stdout.trim();
return {
  type: 'gist',
  url: gistUrl,  // Only the main gist URL
  // Missing: rawUrl for the file
};
```

**For Repositories** (`uploadAsRepo`, lines 294-385):
```javascript
// Current: Constructs repo URL from user and repo name
const repoUrl = `https://github.com/${githubUser}/${repositoryName}`;
return {
  type: 'repo',
  url: repoUrl,  // Only the main repo URL
  // Missing: rawUrl/download_url for the file
};
```

## Proposed Solution

### 1. For Gists

After creating the gist, make an API call to get the raw URL:

```javascript
// Extract gist ID from URL
const gistId = gistUrl.split('/').pop();

// Get gist details to find raw_url
const gistDetails = await $`gh api gists/${gistId} --jq '.files | to_entries | .[0].value.raw_url'`;
const rawUrl = gistDetails.stdout.trim();
```

**Benefits**:
- Raw URL is stable (doesn't expire for secret gists)
- Anyone with the URL can access the content
- No additional authentication required

### 2. For Repositories

After creating the repository, make an API call to get the download URL:

```javascript
// Get file download URL with token
const contentResult = await $`gh api repos/${githubUser}/${repositoryName}/contents/${filename} --jq '.download_url'`;
const rawUrl = contentResult.stdout.trim();
```

**Important considerations**:
- Token expires in ~10 minutes
- For long-term sharing, consider:
  - Making the repository public (fallback option)
  - Instructing users about PAT-based access
  - Adding a note about token expiration in the output

### 3. Fallback Strategy

If private raw URLs aren't practical for sharing (due to token expiration), offer:
- Option to create public repository/gist instead
- Clear warning about token expiration
- Documentation about alternative access methods

### 4. Updated CLI Output

```
✅ Repository created (🔒 private)
🔗 https://github.com/konard/log-home-hive-example
📄 https://raw.githubusercontent.com/konard/log-home-hive-example/main/file.log?token=XXX
⚠️  Note: Raw URL token expires in ~10 minutes. Use the repository URL for permanent access.
```

Or for gists:

```
✅ Gist created (🔒 secret)
🔗 https://gist.github.com/konard/abc123
📄 https://gist.githubusercontent.com/konard/abc123/raw/hash/file.log
```

## Implementation Plan

### Phase 1: Core Implementation

1. **Modify `uploadAsGist()`**:
   - After gist creation, fetch gist details via API
   - Extract and return the `raw_url` for the file(s)
   - Handle multiple files case (return array of raw URLs)

2. **Modify `uploadAsRepo()`**:
   - After repo creation, fetch file content details via API
   - Extract and return the `download_url`
   - Handle multi-file case (when log is split into chunks)

3. **Update return objects**:
   - Add `rawUrl` or `rawUrls` field to return objects
   - Add `fileCount` field to indicate number of files

### Phase 2: CLI Updates

4. **Modify CLI output**:
   - Display raw URL for single-file uploads
   - For multi-file uploads, optionally list all raw URLs or indicate count
   - Add expiration warning for private repository tokens

### Phase 3: Edge Cases

5. **Handle edge cases**:
   - Multi-part logs (files split due to size)
   - API errors when fetching raw URLs
   - Rate limiting considerations

## Test Plan

1. **Unit tests**:
   - Test raw URL extraction from gist API response
   - Test raw URL extraction from repo content API response
   - Test multi-file handling

2. **Integration tests**:
   - Create gist, verify raw URL is accessible
   - Create private repo, verify raw URL with token works
   - Test token expiration behavior (if feasible)

3. **E2E tests**:
   - Full upload flow with raw URL output
   - Verify raw URL content matches original file

## References

- [GitHub REST API - Gists](https://docs.github.com/en/rest/gists/gists)
- [GitHub REST API - Repository Contents](https://docs.github.com/en/rest/repos/contents)
- [GitHub Community Discussion #23845](https://github.com/orgs/community/discussions/23845) - Raw URL token expiration
- [GitHub Community Discussion #22537](https://github.com/orgs/community/discussions/22537) - Permanent raw file links

## Experimental Data

### Test Gist (Secret)

- **Gist URL**: https://gist.github.com/konard/a10feb3d48a2ebd377fb4d863850115b
- **Raw URL**: https://gist.githubusercontent.com/konard/a10feb3d48a2ebd377fb4d863850115b/raw/4f1cf9f631af4dcf6f82b7a965d6b02c45ba525c/test-gist-experiment.log
- **Accessible without auth**: Yes (HTTP 200)

### Test Private Repository

- **Repo URL**: https://github.com/konard/test-private-repo-experiment
- **Raw URL with token**: https://raw.githubusercontent.com/konard/test-private-repo-experiment/main/test-private-repo.log?token=AAK5SYBWWMKMPF7LHZBYIETJOUGEA
- **Accessible without auth**: Yes (HTTP 200, but token expires after ~10 minutes)

## Conclusion

The feature request is valid and implementable. The solution involves:

1. **For gists**: Fetching and displaying the permanent `raw_url` from the API
2. **For private repos**: Fetching the `download_url` with token, with clear communication about expiration
3. **User education**: Adding warnings about private repo token expiration

The gist implementation is straightforward since raw URLs don't expire. The repository implementation requires careful consideration of the token expiration issue and may benefit from a fallback to public visibility or clear documentation about access methods.

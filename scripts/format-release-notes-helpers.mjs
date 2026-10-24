/**
 * Pure helpers for create-github-release.mjs and format-release-notes.mjs,
 * kept free of side effects so they can be unit tested.
 *
 * The release body is the CHANGELOG.md section Changesets wrote. It used to
 * be "cleaned" with regexes that dated from passing bodies through shell
 * arguments: every line was trimmed (nested lists flattened, as in the
 * v0.9.0 release), everything after the first `---` was cut along with every
 * later entry, literal `\n` in code spans became line breaks, and only the
 * first entry's PR was linked. The body is now sent as JSON, so the changes
 * are published as Changesets wrote them (template issues #236 and #242).
 */

const CHANGES_HEADING = /^### (Major|Minor|Patch) Changes$/;
const OTHER_HEADING = /^#{1,3} /;
const ENTRY = /^- (?:([0-9a-f]{7,40}): )?/;

function trimBlankLines(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === '') {
    start += 1;
  }
  while (end > start && lines[end - 1] === '') {
    end -= 1;
  }
  return lines.slice(start, end);
}

/**
 * Turn the single entry of a single section into plain text: drop the
 * `- <hash>: ` marker and the two-space indent of its continuation lines, so
 * nested lists keep their structure one level up.
 */
function unwrapSingleEntry(lines) {
  return lines.map((line, index) => {
    if (index === 0) {
      return line.replace(ENTRY, '');
    }
    return line.startsWith('  ') ? line.slice(2) : line;
  });
}

/**
 * @param {string} body GitHub release body
 * @returns {{ description: string, commitHashes: string[] } | null} null when
 *   the body has no `### Major|Minor|Patch Changes` section
 */
export function buildReleaseDescription(body) {
  const sections = [];
  let current = null;
  for (const rawLine of body.replaceAll('\r\n', '\n').split('\n')) {
    const line = rawLine.replace(/[ \t]+$/, '');
    if (CHANGES_HEADING.test(line)) {
      current = { heading: line, lines: [] };
      sections.push(current);
    } else if (OTHER_HEADING.test(line)) {
      current = null;
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (sections.length === 0) {
    return null;
  }

  const commitHashes = [];
  for (const section of sections) {
    section.lines = trimBlankLines(section.lines);
    for (const line of section.lines) {
      const hash = line.match(ENTRY)?.[1];
      if (hash && !commitHashes.includes(hash)) {
        commitHashes.push(hash);
      }
    }
  }

  let description;
  if (sections.length === 1) {
    const { lines } = sections[0];
    const entries = lines.filter((line) => ENTRY.test(line)).length;
    description = (
      entries === 1 && ENTRY.test(lines[0]) ? unwrapSingleEntry(lines) : lines
    ).join('\n');
  } else {
    description = sections
      .map(({ heading, lines }) => [heading, '', ...lines].join('\n'))
      .join('\n\n');
  }
  return { description, commitHashes };
}

/**
 * @param {number[]} prNumbers unique pull request numbers
 * @returns {string} the related pull request line, or '' when there is none
 */
export function formatRelatedPullRequests(prNumbers) {
  if (prNumbers.length === 0) {
    return '';
  }
  const label =
    prNumbers.length === 1 ? 'Related Pull Request' : 'Related Pull Requests';
  return `**${label}:** ${prNumbers.map((number) => `#${number}`).join(', ')}`;
}

/**
 * shields.io splits a static badge path on single dashes, so the package
 * name `gh-upload-log` became "404: badge not found". Dashes and underscores
 * are doubled, as in the pipeline template's helper of the same name.
 */
export function encodeShieldsStaticBadgeSegment(value) {
  return encodeURIComponent(value).replace(/-/g, '--').replace(/_/g, '__');
}

export function buildNpmVersionBadge(packageName, releaseVersion) {
  const version = releaseVersion.replace(/^v/, '');
  const label = encodeShieldsStaticBadgeSegment(packageName);
  const message = encodeShieldsStaticBadgeSegment(version);
  return `[![${packageName} npm version](https://img.shields.io/badge/${label}-${message}-blue.svg)](https://www.npmjs.com/package/${packageName}/v/${encodeURIComponent(version)})`;
}

/**
 * The CHANGELOG.md section of `version`, without its heading, or '' when
 * there is none. The heading must be exactly `## <version>`: the regex this
 * replaces left the dots unescaped and had no boundary after the version, so
 * `1.0.1` read the `## 1.0.10` section, and any `## <digit>` inside an entry
 * ended the section (fixed the same way in the pipeline template).
 */
export function extractChangelogSection(changelog, version) {
  const lines = changelog.replaceAll('\r\n', '\n').split('\n');
  const start = lines.findIndex((line) => line.trimEnd() === `## ${version}`);
  if (start === -1) {
    return '';
  }
  const next = lines.findIndex(
    (line, index) => index > start && /^## /.test(line)
  );
  return lines
    .slice(start + 1, next === -1 ? lines.length : next)
    .join('\n')
    .trim();
}

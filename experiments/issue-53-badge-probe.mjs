// Read-only live reproduction: bun experiments/issue-53-badge-probe.mjs [--verbose]
const verbose = process.argv.includes('--verbose');
for (const name of ['gh-upload-file', 'gh-upload-log']) {
  for (const url of [
    `https://registry.npmjs.org/${name}/latest`,
    `https://registry.npmjs.org/-/package/${name}/dist-tags`,
    `https://img.shields.io/npm/v/${name}.svg`,
  ]) {
    const response = await fetch(url, {
      signal: globalThis.AbortSignal.timeout(30_000),
    });
    const body = await response.text();
    console.log(
      JSON.stringify({
        time: new Date().toISOString(),
        url,
        status: response.status,
        result: body.startsWith('<svg')
          ? body.match(/<title>(.*?)<\/title>/)?.[1]
          : JSON.parse(body),
        ...(verbose ? { headers: Object.fromEntries(response.headers) } : {}),
      })
    );
  }
}

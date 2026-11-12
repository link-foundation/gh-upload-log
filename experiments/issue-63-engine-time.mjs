import { createSanitizer } from '@link-foundation/sensitive-data-sanitizer';
const text = `${Array.from(
  { length: 20000 },
  (_, i) => `line ${i} token ghp…b4N and Bearer 012…567`
).join('\n')}\n`;
const e = createSanitizer({ credentialsOnly: true });
let t = Date.now();
const r = await e.sanitize(text);
console.log('pass1', Date.now() - t, r.redactions, r.text === text);
t = Date.now();
const r2 = await e.sanitize(r.text);
console.log('pass2', Date.now() - t, r2.redactions);
console.log(Object.keys(e));

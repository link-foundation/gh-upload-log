import { createSanitizer } from '@link-foundation/sensitive-data-sanitizer';
const text = `${'A'.repeat(15 * 1024 * 1024)}\npassword=xx-private-value\n`;
const e = createSanitizer({
  credentialsOnly: true,
  maxInputLength: 64 * 1024 * 1024,
});
try {
  const r = await e.sanitize(text);
  console.log('ok', r.redactions);
} catch (err) {
  console.log(err.code, err.message);
}

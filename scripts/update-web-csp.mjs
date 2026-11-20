// Update the hash of the inline application script for the single-file build.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../web/index.html', import.meta.url);
const html = await readFile(path, 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (scripts.length !== 1) throw new Error('Expected one inline application script');
const hash = createHash('sha384').update(scripts[0][1].replace(/\r\n?/g, '\n')).digest('base64');
const updated = html.replace(/(<meta http-equiv="Content-Security-Policy" content="[^"]*\bscript-src )'sha384-[A-Za-z0-9+/=]+'/, `$1'sha384-${hash}'`);
if (!html.includes('http-equiv="Content-Security-Policy"') || !updated.includes(`script-src 'sha384-${hash}'`)) {
  throw new Error('Inline script hash is missing from the content security policy');
}
if (process.argv.includes('--check')) {
  if (html !== updated) throw new Error('Run node scripts/update-web-csp.mjs to refresh the inline script hash');
} else if (html !== updated) {
  await writeFile(path, updated);
}

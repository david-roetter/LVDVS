import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const source = fileURLToPath(new URL('./', import.meta.url));
const destination = resolve('public');
const required = ['index.html', 'style.css', 'impressum.html', 'datenschutz.html', 'robots.txt', 'favicon.svg', 'ludus/index.html', 'peachex/index.html', 'integrations.json', 'tidal/index.html'];
const integration = JSON.parse(await readFile(resolve(source, 'integrations.json'), 'utf8'));
if (integration.ludus.url !== 'https://ludus-chronicle.onrender.com/' || integration.peachex.payments_enabled !== false) {
  throw new Error('Unexpected integration configuration. Review the payment and session flow before enabling it.');
}
const files = await Promise.all(required.map(async name => ({ name, bytes: await readFile(resolve(source, name)) })));
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const { name } of files) await cp(resolve(source, name), resolve(destination, name), { recursive: true });
const revision = process.env.RENDER_GIT_COMMIT || 'local';
await readFile(resolve(destination, 'ludus/index.html'));
const hashes = Object.fromEntries(files.map(({ name, bytes }) => [name, createHash('sha256').update(bytes).digest('hex')]));
await import('node:fs/promises').then(fs => fs.writeFile(resolve(destination, 'build-info.json'), JSON.stringify({ revision, hashes }, null, 2) + '\n'));
console.log(`Published ${files.length} verified company files (${revision}).`);

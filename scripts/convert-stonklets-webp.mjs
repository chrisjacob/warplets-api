import { readdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let sharp;
try { sharp = require('sharp'); }
catch {
  const packages = await readdir(path.join(root, 'node_modules/.pnpm'));
  const installed = packages.filter(name => /^sharp@/.test(name)).sort().at(-1);
  if (!installed) throw new Error('Install sharp before running this script.');
  sharp = require(path.join(root, 'node_modules/.pnpm', installed, 'node_modules/sharp'));
}
const folder = path.join(root, 'app/public/stonklets/stonklets');
let before = 0, after = 0, count = 0;
for (const file of await readdir(folder)) {
  if (!/\.(png|jpe?g)$/i.test(file)) continue;
  const source = path.join(folder, file);
  const destination = source.replace(/\.(png|jpe?g)$/i, '.webp');
  const original = await sharp(source).metadata();
  await sharp(source).webp({ quality: 90, effort: 6 }).toFile(destination);
  const converted = await sharp(destination).metadata();
  if (converted.width !== original.width || converted.height !== original.height || converted.format !== 'webp') throw new Error(`Verification failed: ${file}`);
  before += (await stat(source)).size;
  after += (await stat(destination)).size;
  count++;
}
console.log(JSON.stringify({ count, originalBytes: before, webpBytes: after, savedPercent: ((1 - after / before) * 100).toFixed(1) }));

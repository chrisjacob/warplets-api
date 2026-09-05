import { createRequire } from 'node:module';
import { readdir, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const installed = (await readdir(path.join(root,'node_modules/.pnpm'))).filter(name=>/^sharp@/.test(name)).sort().at(-1);
if (!installed) throw new Error('Install sharp before generating thumbnails');
const sharp = require(path.join(root,'node_modules/.pnpm',installed,'node_modules/sharp'));
const folder = path.join(root,'app/public/stonklets/stonklets');
let count=0,bytes=0;
for (const size of [128,256,512]) await mkdir(path.join(folder,'thumbs',String(size)),{recursive:true});
for (const file of await readdir(folder)) {
 if (!file.endsWith('.webp')) continue;
 for (const size of [128,256,512]) {
  const out=path.join(folder,'thumbs',String(size),file);
  await sharp(path.join(folder,file)).resize(size,size,{fit:'cover'}).webp({quality:90,effort:6}).toFile(out);
  bytes+=(await stat(out)).size;count++;
 }
}
console.log(JSON.stringify({count,bytes}));

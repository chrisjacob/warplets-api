import {readFileSync,readdirSync} from 'node:fs';
import {dirname,resolve,sep} from 'node:path';
const root=resolve(import.meta.dirname,'..');
function check(directory){
 for(const entry of readdirSync(directory,{withFileTypes:true})){
  const file=resolve(directory,entry.name);
  if(entry.isDirectory()){check(file);continue;}
  if(!/\.(?:ts|tsx)$/.test(entry.name))continue;
  const source=readFileSync(file,'utf8');
  for(const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/g)){
   const specifier=match[1];
   if(/(?:^|\/)(?:discovery|network)(?:\/|$)/.test(specifier))throw Error(`Archived/analytics runtime import in ${file}`);
   if(specifier.startsWith('.')&&!resolve(dirname(file),specifier).startsWith(root+sep))throw Error(`Relative import escapes the launchpad package: ${file}`);
  }
 }
}
check(resolve(root,'src'));console.log('Launchpad source imports stay inside their package boundary.');

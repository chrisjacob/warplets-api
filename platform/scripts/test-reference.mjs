import {readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {join,relative} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const skip=new Set(['node_modules','edge','site','.local','.wrangler']);
function discover(path) {
  return readdirSync(path,{withFileTypes:true}).flatMap(entry=>{
    if(skip.has(entry.name)||entry.name.startsWith('.'))return [];
    const file=join(path,entry.name);
    if(entry.isDirectory())return discover(file);
    return entry.name.endsWith('.test.mjs')?[file]:[];
  });
}
// The runner already uses root as cwd. Relative arguments preserve discovery
// while keeping a large suite below Windows' command-line length ceiling.
const suite=discover(root).sort().map(file=>relative(root,file));
if(!suite.length)throw Error('No tests discovered.');
const result=spawnSync(process.execPath,['--test',...suite],{cwd:root,stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;

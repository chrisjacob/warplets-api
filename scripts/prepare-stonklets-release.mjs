// Package the selected clean revision without restoring historical files.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const revision = process.argv[2] || 'HEAD';
const commit = execFileSync('git', ['rev-parse', revision], {encoding:'utf8'}).trim();
const output = path.resolve('.tmp', `stonklets-release-${commit.slice(0,12)}`);
if (existsSync(output)) throw new Error(`Release already exists: ${output}`);
const files = execFileSync('git', ['ls-tree','-r','--name-only',commit], {encoding:'utf8'}).trim().split('\n');
const retired = files.filter(file => /^(?:app\/src\/Social|app\/functions\/_lib\/social|app\/functions\/api\/social\/|migrations\/\d+_social)/.test(file));
if (retired.length) throw new Error(`Selected revision still contains the retired app: ${retired.join(', ')}`);
for (const file of files) {
 const target=path.join(output,file);
 const contents=execFileSync('git',['show',`${commit}:${file}`],{maxBuffer:100*1024*1024});
 mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,contents);
}
writeFileSync(path.join(output,'release-manifest.json'),JSON.stringify({commit,scope:'Selected revision; no historical file replacements'},null,2));
console.log(output);

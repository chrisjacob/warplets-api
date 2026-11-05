import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
test('portable service graph bundles without Node or fixture/provider imports',async()=>{
  const entryPoints=['../../earn/service.mjs','../../application/context.mjs','../../security/web-crypto.mjs'].map(p=>fileURLToPath(new URL(p,import.meta.url)));
  const result=await build({entryPoints,bundle:true,platform:'browser',format:'esm',outdir:'unused-output',write:false,metafile:true,logLevel:'silent'});
  for(const name of Object.keys(result.metafile.inputs))assert.doesNotMatch(name,/(?:fixtures|node-context|storage\/|pricing\/)/);
  for(const file of result.outputFiles)assert.doesNotMatch(file.text,/node:|\bBuffer\b|\bfetch\s*\(/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
test('portable quote verification bundles without Node compatibility imports',async()=>{
 const bundle=await build({entryPoints:[fileURLToPath(new URL('../../quotes/verification.mjs',import.meta.url))],bundle:true,platform:'browser',format:'esm',write:false,target:'es2022'});
 assert.ok(!/from ["']node:|\bBuffer\b/.test(bundle.outputFiles[0].text));
});

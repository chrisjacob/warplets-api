import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {encode58} from '../../server/base58.mjs';

test('real workerd verifies a D1 wallet proof once and protects R2 public artifacts',async t=>{
 const entry=fileURLToPath(new URL('../src/worker.ts',import.meta.url));
 const bundle=await build({entryPoints:[entry],bundle:true,platform:'browser',format:'esm',write:false,
   sourcemap:false,minify:false,target:'es2022'});
 const mf=new Miniflare({workers:[{config:{name:'tenx-test',type:'worker',compatibilityDate:'2026-08-25',
   manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},
   env:{DB:{type:'d1',id:'00000000-0000-4000-8000-000000000001'},MANIFESTS:{type:'r2',name:'tenx-local-manifests'}}}}]});
 t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('MANIFESTS');
 for(const name of ['001-identity','002-markets','012-edge-proofs']){
   const sql=readFileSync(new URL('../../storage/'+name+'.sql',import.meta.url),'utf8').replace(/^--.*$/gm,'');
   await db.batch(sql.split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
 }
 const origin='http://localhost',url=origin+'/api/v1';
 const get=(path,headers={})=>mf.dispatchFetch(url+path,{headers});
 const post=(path,body,headers={})=>mf.dispatchFetch(url+path,{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)});
 const policy=await (await get('/policy')).json();assert.equal(policy.version,'prd-1.2');
 assert.equal((await get('/me')).status,401);assert.equal((await get('/markets')).status,200);
 const pair=generateKeyPairSync('ed25519'),wallet=encode58(pair.publicKey.export({format:'der',type:'spki'}).subarray(-32));
 assert.equal((await post('/auth/challenges',{wallet},{origin:'http://outside.test'})).status,403);
 const challengeRes=await post('/auth/challenges',{wallet});assert.equal(challengeRes.status,201);
 const challenge=await challengeRes.json();
 const proof={nonce:challenge.nonce,signature:encode58(sign(null,Buffer.from(challenge.message),pair.privateKey))};
 const replies=await Promise.all([post('/auth/verify',proof),post('/auth/verify',proof)]);
 assert.deepEqual(replies.map(r=>r.status).sort(),[200,401]);
 const cookie=replies.find(r=>r.status===200).headers.get('set-cookie').split(';')[0];
 assert.equal((await (await get('/me',{cookie})).json()).wallet,wallet);
 await post('/auth/logout',{}, {cookie});assert.equal((await get('/me',{cookie})).status,401);
 const document='{"policy":"prd-1.2","audience":"public"}',key=createHash('sha256').update(document).digest('hex'),objectKey='public/'+key+'.json';
 await bucket.put(objectKey,document);
 assert.equal((await get('/manifests/'+key)).status,404);
 await db.prepare('INSERT INTO manifest_catalog VALUES(?,?,?,?,?)').bind(key,objectKey,Buffer.byteLength(document),'public-test',Date.now()).run();
 const out=await get('/manifests/'+key);assert.equal(out.status,200);assert.equal(await out.text(),document);
 await bucket.put(objectKey,document.replace('public','SECRET'));
 const broken=await get('/manifests/'+key);assert.equal(broken.status,503);assert.ok(!(await broken.text()).includes('SECRET'));
 assert.equal((await mf.dispatchFetch('https://public.example/api/v1/policy')).status,403);
});

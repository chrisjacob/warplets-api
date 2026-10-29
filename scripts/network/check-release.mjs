import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'../..');
const flags=[readFileSync(resolve(root,'wrangler.toml'),'utf8'),readFileSync(resolve(root,'app/wrangler.toml'),'utf8')].map(s=>s.split(/^\[vars\]\s*$/m)[1]?.split(/^\[/m)[0]??'');
const enabled=(text,key)=>new RegExp(`^${key}\\s*=\\s*"true"\\s*$`,'m').test(text);
if(!enabled(flags[0],'NETWORK_INGEST_ENABLED')&&!enabled(flags[1],'NETWORK_ENABLED')){
 console.log('Network prepare stage: serving and collection remain disabled.');
}else{
 const wrangler=resolve(root,'node_modules/wrangler/bin/wrangler.js');
 const sql="SELECT (SELECT value FROM network_sync WHERE key='bootstrap:ready') AS ready,(SELECT value FROM network_sync WHERE key='last_success') AS lastSuccess,(SELECT created_at FROM network_snapshots ORDER BY created_at DESC LIMIT 1) AS snapshotAt,(SELECT COUNT(*) FROM network_profiles) AS profiles";
 const result=spawnSync(process.execPath,[wrangler,'d1','execute','warplets','--remote','--command',sql,'--json'],{cwd:root,encoding:'utf8',windowsHide:true});
 if(result.status!==0)throw Error('Cannot verify production Network bootstrap');
 const row=JSON.parse(result.stdout)[0]?.results?.[0];
 const ready=JSON.parse(row?.ready??'null');
 assert(ready&&/^[a-f0-9]{64}$/.test(ready.manifestSha256)&&row.profiles>0,'Verified Network bootstrap required before ingestion activation');
 if(enabled(flags[1],'NETWORK_ENABLED')){
  const success=JSON.parse(row.lastSuccess??'null');
  assert(success?.at>=ready.verifiedAt&&row.snapshotAt>=ready.verifiedAt,'A successful production ingestion and snapshot are required before public serving');
 }
 console.log('Network production readiness verified.');
}

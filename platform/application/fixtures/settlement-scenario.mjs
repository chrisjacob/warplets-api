// Complete synthetic transcripts for local B07 acceptance. No live providers.
import {cutoffScenario} from './cutoff-scenario.mjs';
import {recordSamplePrice} from '../../pricing/fixtures.mjs';
import {DAY_MS} from '../../domain/earn/index.mjs';

export async function settlementScenario({wallets=10,campaigns=1,day=2,extraPost=false,extremes=false,beforeFreeze}={}){
 return cutoffScenario({post:false,async beforeFreeze(context){
  const {db,epoch,start,cutoff}=context;
  db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run('synthetic-snapshot','jobs-runner');
  const activation=start-(day-2)*DAY_MS;
  db.prepare('UPDATE earn_fixture_campaigns SET activation_ms=? WHERE token_id=?').run(activation,'A');
  for(let n=1;n<campaigns;n++)db.prepare('INSERT INTO earn_fixture_campaigns VALUES(?,?,?)').run('campaign-'+n,activation+35*60*1000,'1000000');
  for(let n=0;n<wallets;n++){
   const wallet='synthetic-wallet-'+String(n).padStart(3,'0'),tokenId=n%campaigns===0?'A':'campaign-'+n%campaigns;
   const score=extremes?(n===0?1:n===1?10:7):7;
   addPost(wallet,tokenId,'synthetic-post-'+n,score,start+3600001);
   db.prepare('INSERT INTO earn_owner_snapshots VALUES(?,?,?,?)').run(epoch,wallet,'[]','synthetic-empty-owner-'+n);
   if(extraPost&&n===0){if(campaigns<2)throw Error('Multiple-post fixture requires two campaigns.');addPost(wallet,'campaign-1','synthetic-second-post',10,start+3600002);}
  }
  function addPost(wallet,tokenId,id,score,submittedMs){
   const entry=recordSamplePrice(db,{wallet,tokenId,asOfMs:start+3600000,stakedUnits:'10000000',validUntilMs:start+3600100});
   db.prepare('INSERT INTO earn_submissions VALUES(?,?,?,?,?,?,?,?)').run(id,wallet,tokenId,epoch,'https://example.test/'+id,submittedMs,entry.receipt,id);
   db.prepare('INSERT INTO earn_reviews VALUES(?,?,?,?,?,?)').run(id,score,'synthetic-moderator','Synthetic B07 acceptance',start+3600003,'synthetic-review-'+id);
   recordSamplePrice(db,{wallet,tokenId,asOfMs:cutoff,stakedUnits:'10000000'});
  }
  if(beforeFreeze)await beforeFreeze(context);
 }});
}

export const settlementSeedTables=['app_operator_scopes','earn_fixture_campaigns','price_sources','earn_stake_reads','price_observations','ops_config_audit',
 'earn_submissions','earn_reviews','earn_owner_snapshots','earn_boards','earn_streaks','app_command_receipts','app_epoch_freezes','app_private_artifacts',
 'app_evidence_sources','app_evidence_receipts','app_evidence_heads'];

export async function copySettlementSeed(node,db,r2){
 for(const table of settlementSeedTables){
  const statements=node.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(row=>{
   const keys=Object.keys(row);return db.prepare('INSERT INTO '+table+' ('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').bind(...Object.values(row));
  });
  for(let offset=0;offset<statements.length;offset+=100)await db.batch(statements.slice(offset,offset+100));
 }
 // Restore this synthetic clone's captured versions after insertion triggers.
 // Both runtimes now start from exactly the same state, before B05 assembly.
 for(const {name,revision} of node.db.prepare('SELECT * FROM app_revisions').all())await db.prepare('UPDATE app_revisions SET revision=? WHERE name=?').bind(revision,name).run();
 const objects=[...node.objects];for(let offset=0;offset<objects.length;offset+=16)await Promise.all(objects.slice(offset,offset+16).map(([key,bytes])=>r2.put(key,bytes,{httpMetadata:{contentType:key.endsWith('.json')?'application/json':'application/octet-stream'}})));
}

import {createHash} from 'node:crypto';
import {decode58} from '../server/base58.mjs';
import {canonicalJson} from '../security/canonical.mjs';
import {checkTimestamp,snapshotSeasonFreeWallets} from '../domain/collections/policy.mjs';
const LIMIT=10000,hash=value=>createHash('sha256').update(canonicalJson(value)).digest('hex');
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value);
const timestamp=value=>{try{checkTimestamp(value);return true;}catch{return false;}};
const wallet=value=>{try{return typeof value==='string'&&(decode58(value,32),true);}catch{return false;}};

/** Operator-only diagnostic. Every read belongs to one SQLite read snapshot.
 * Coverage is an explicit local transcript assertion, never a chain verification.
 * A ready result has no authority to publish and performs no state mutation. */
export function previewSeasonEligibility(db,input,now=Date.now()){
 const packet=structuredClone(input);checkTimestamp(now);
 if(!identifier(packet?.inventoryId)||!identifier(packet?.stageId)||!identifier(packet?.sourceRef))throw Error('Invalid bounded snapshot identity.');
 if(!Array.isArray(packet.holdings)||packet.holdings.length>LIMIT)throw Error('Provide at most 10000 holdings.');
 if(!packet.coverage||!Array.isArray(packet.coverage.pages)||packet.coverage.pages.length>100)throw Error('Provide at most 100 coverage pages.');
 if(Buffer.byteLength(JSON.stringify(packet))>4*1024*1024)throw Error('Preview packet exceeds 4 MiB.');
 const ownTransaction=!db.isTransaction;if(ownTransaction)db.exec('BEGIN');
 try{return inspect(db,packet,now);}finally{if(ownTransaction)db.exec('ROLLBACK');}
}
function inspect(db,p,now){
 const inventory=db.prepare('SELECT kind,state,revision FROM collect_inventories WHERE id=?').get(p.inventoryId);
 const stage=inventory&&JSON.parse(inventory.state).stages.find(stage=>stage.id===p.stageId);
 if(inventory?.kind!=='season'||stage?.type!=='free')throw Error('Select an existing published Season free stage.');
 const cutoffMs=stage.opensAt,issues=[],rows=[],indexed=new Map(),normalizationIssues=[];
 const issue=(code,assetId=null)=>issues.push({code,assetId});
 if(p.at!==cutoffMs)issue('wrong-opening-cut');
 if(p.finalized!==true||!timestamp(p.at)||p.at>now)issue('snapshot-not-final');
 const source=p.source;
 if(!source||source.id!==p.sourceRef||source.chain!=='solana'||source.collection!=='solana-genesis'||
   typeof source.slot!=='string'||!/^(0|[1-9]\d{0,19})$/.test(source.slot)||BigInt(source.slot)>((1n<<64n)-1n)||
   source.blockTimeMs!==cutoffMs||!identifier(source.ownerRef)||!identifier(source.revealRef))issue('source-anchor-incomplete');
 for(let index=0;index<p.holdings.length;index++){
  const value=p.holdings[index];
  if(!value||!identifier(value.id)||!identifier(value.collection)){issue('invalid-holding',null);continue;}
  if(!wallet(value.owner)){
   normalizationIssues.push({index,assetId:value.id,reason:typeof value.owner==='string'&&value.owner.trim()!==value.owner?'wallet-whitespace':'noncanonical-solana-address'});
   issue('invalid-wallet',value.id);continue;
  }
  const nft={id:value.id,owner:value.owner,collection:value.collection,level:value.level??null,revealedAt:value.revealedAt??null};
  if((nft.level!==null&&(!Number.isInteger(nft.level)||nft.level<1||nft.level>10))||(nft.revealedAt!==null&&!timestamp(nft.revealedAt))){issue('invalid-reveal',nft.id);continue;}
  if(indexed.has(nft.id)){issue(canonicalJson(indexed.get(nft.id))===canonicalJson(nft)?'duplicate-holding':'conflicting-holding',nft.id);continue;}
  indexed.set(nft.id,nft);
 }
 const canonical=[...indexed.values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 const coverage=p.coverage,seenIds=new Set(),seenCursors=new Set();let cursor=null,complete=true;
 if(coverage.status!=='complete'||!Number.isInteger(coverage.expectedCount)||coverage.expectedCount<0||coverage.expectedCount>LIMIT||coverage.expectedCount!==p.holdings.length||coverage.pages.length===0)complete=false;
 for(let index=0;index<coverage.pages.length;index++){
  const page=coverage.pages[index];
  if(!page||!Array.isArray(page.ids)||page.ids.length>100||page.cursor!==cursor||seenCursors.has(page.cursor)||
    !(page.cursor===null||identifier(page.cursor))||!(page.nextCursor===null||identifier(page.nextCursor))){complete=false;continue;}
  seenCursors.add(page.cursor);
  for(const id of page.ids){if(!indexed.has(id)||seenIds.has(id))complete=false;seenIds.add(id);}
  cursor=page.nextCursor;
  if(index<coverage.pages.length-1&&cursor===null)complete=false;
 }
 if(cursor!==null||seenIds.size!==canonical.length||canonical.length!==p.holdings.length)complete=false;
 if(!complete)issue('snapshot-incomplete');
 const tracked=db.prepare(`SELECT a.id,a.reveal_ms,a.asset,
  (SELECT v.body FROM vault_observations v WHERE v.asset_id=a.id AND v.observed_ms<=? AND v.kind IN ('bind','transfer') ORDER BY v.observed_ms DESC,v.rowid DESC LIMIT 1) AS owner_body
  FROM collect_assets a JOIN collect_inventories i ON i.id=a.inventory_id WHERE i.kind='genesis' AND a.bind_ms<=? ORDER BY a.id LIMIT 10001`).all(cutoffMs,cutoffMs);
 if(tracked.length>LIMIT)issue('tracked-inventory-bound');
 const trackedById=new Map(tracked.slice(0,LIMIT).map(row=>[row.id,row]));
 for(const known of tracked.slice(0,LIMIT)){
  const nft=indexed.get(known.id),owner=known.owner_body&&JSON.parse(known.owner_body),revealed=known.reveal_ms!==null&&known.reveal_ms<=cutoffMs;
  if(!nft){issue('missing-tracked-holding',known.id);continue;}
  if(nft.collection!=='solana-genesis'||!owner||nft.owner!==(owner.to??owner.owner)||
    (revealed?(nft.revealedAt!==known.reveal_ms||nft.level!==JSON.parse(known.asset).level):(nft.revealedAt!==null&&nft.revealedAt<=cutoffMs)))issue('conflicting-local-cut',known.id);
 }
 // Bound this lookup to the supplied packet; never enumerate unrelated owners.
 for(let offset=0;offset<canonical.length;offset+=100){
  const group=canonical.slice(offset,offset+100),known=db.prepare(`SELECT a.id,a.bind_ms,i.kind FROM collect_assets a JOIN collect_inventories i ON i.id=a.inventory_id WHERE a.id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(group.map(row=>row.id)));
  for(const row of known)if(indexed.get(row.id).collection==='solana-genesis'&&(row.kind!=='genesis'||row.bind_ms>cutoffMs))issue('wrong-local-collection',row.id);
 }
 const conflictedIds=new Set(issues.filter(row=>row.assetId!==null).map(row=>row.assetId));
 for(const nft of canonical){
  const known=trackedById.get(nft.id),late=nft.collection==='solana-genesis'&&((nft.revealedAt!==null&&nft.revealedAt>cutoffMs)||(known?.reveal_ms!==null&&known?.reveal_ms>cutoffMs));
  const reason=conflictedIds.has(nft.id)?'conflict':nft.collection!=='solana-genesis'?'not-genesis':late?'late-reveal':nft.revealedAt===null?'unrevealed-at-cut':nft.level===null?'unknown-level':nft.level===1?'eligible':'level-not-one';
  if(reason==='unknown-level')issue('missing-revealed-level',nft.id);
  rows.push({assetId:nft.id,wallet:nft.owner,reason});
 }
 const prior=db.prepare('SELECT id,snapshot_hash FROM collect_snapshots WHERE inventory_id=? AND stage_id=?').get(p.inventoryId,p.stageId);
 // Exact compatibility digest of the existing immutable importer, with its ordered fields.
 const snapshotDigest=createHash('sha256').update(JSON.stringify([p.inventoryId,p.stageId,p.at,p.sourceRef,canonical])).digest('hex');
 if(prior&&prior.snapshot_hash!==snapshotDigest)issue('published-snapshot-conflict');
 const ready=issues.length===0,candidateSet=new Set(rows.filter(row=>row.reason==='eligible').map(row=>row.wallet)),candidates=[...candidateSet].sort(),walletReasons=new Map();
 for(const row of rows){if(!walletReasons.has(row.wallet))walletReasons.set(row.wallet,new Set());walletReasons.get(row.wallet).add(row.reason);}
 const wallets=[...walletReasons.keys()].sort().map(owner=>({wallet:owner,status:!ready?'unknown':candidateSet.has(owner)?'eligible':'ineligible',reasons:[...walletReasons.get(owner)].sort()}));
 if(ready){const expected=snapshotSeasonFreeWallets({at:cutoffMs,holdings:canonical}).wallets;if(JSON.stringify(expected)!==JSON.stringify(candidates))throw Error('Preview disagrees with the frozen-cut policy.');}
 return {mode:'local-fixture',readOnly:true,executable:false,chainCompleteness:'unverified',inventoryId:p.inventoryId,stageId:p.stageId,
  inventoryRevision:inventory.revision,termsDigest:stage.termsDigest,cutoffAt:new Date(cutoffMs).toISOString(),asOf:new Date(now).toISOString(),
  source:source??null,sourceDigest:hash(source??null),inputDigest:hash(p),snapshotDigest,
  publication:{status:prior?(prior.snapshot_hash===snapshotDigest?'already-published':'conflict'):ready?'ready-local-fixture':'held',snapshotId:prior?.id??null},
  counts:{inputHoldings:p.holdings.length,eligibleCandidates:candidates.length,eligibleWallets:ready?candidates.length:0,unknownWallets:wallets.filter(row=>row.status==='unknown').length,
   lateRevealHoldings:rows.filter(row=>row.reason==='late-reveal').length,conflicts:issues.filter(row=>['conflicting-holding','conflicting-local-cut','wrong-local-collection','published-snapshot-conflict','missing-tracked-holding'].includes(row.code)).length,
   duplicates:issues.filter(row=>row.code==='duplicate-holding').length,normalizationIssues:normalizationIssues.length},
  coverage:{status:complete?'complete-local-transcript':'incomplete',expectedCount:coverage.expectedCount??null,observedCount:canonical.length,pages:coverage.pages.length},
  ready,issues,normalizationIssues,wallets,holdings:rows};
}

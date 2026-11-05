import {createHash} from 'node:crypto';
import {LEVEL_QUOTAS,seasonExpiry} from '../domain/collections/policy.mjs';
import {launchAllocations} from '../domain/economics/launch.mjs';
import {createSeasonSnapshot} from '../domain/economics/vault.mjs';
import {importMarket} from '../markets/catalog.mjs';
import {addCampaign} from '../earn/workflow.mjs';
import {seedFarm} from '../stake/farms.mjs';
import {recordVaultManifest,timestamp} from '../vault/ledger.mjs';
import {canonical} from '../transactions/canonical.mjs';
import {transaction} from '../storage/database.mjs';

const initialLevels=LEVEL_QUOTAS.flatMap((n,i)=>Array(n).fill(i+1));
const localCalendar=new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'});
const sha=value=>createHash('sha256').update(canonical(value)).digest('hex');

export function seasonsAt(db,activationMs) {
 const rows=db.prepare("SELECT id,season_start FROM collect_inventories WHERE kind='season' AND season_start<=? ORDER BY season_start DESC LIMIT 12")
  .all(activationMs).filter(i=>activationMs<seasonExpiry(i.season_start,10));
 return rows.map(({id,season_start})=>{
  const levels=initialLevels.slice();
  const history=db.prepare(`WITH ranked AS (
   SELECT a.slot,h.level,ROW_NUMBER() OVER(PARTITION BY a.id ORDER BY h.effective_ms DESC,h.seq DESC) AS n
   FROM collect_assets a JOIN collect_level_history h ON h.asset_id=a.id
   WHERE a.inventory_id=? AND h.effective_ms<=?
  ) SELECT slot,level FROM ranked WHERE n=1`).all(id,activationMs);
  for(const change of history)levels[JSON.parse(change.slot).slotIndex]=change.level;
  // Refuse to infer a missing historical Level on old preview databases.
  const gap=db.prepare(`SELECT 1 FROM collect_operations op JOIN collect_assets a
    ON a.id IN (json_extract(op.operation,'$.targetId'),json_extract(op.operation,'$.materialId'))
    WHERE op.inventory_id=? AND op.kind='upgrade' AND op.settled_ms<=?
    AND NOT EXISTS(SELECT 1 FROM collect_level_history h WHERE h.asset_id=a.id AND h.effective_ms>=op.settled_ms AND h.effective_ms<=?)
    LIMIT 1`).get(id,activationMs,activationMs);
  if(gap)throw Error('Incomplete historical Season Level evidence at activation.');
  return {id,startsAt:new Date(season_start).toISOString(),levels};
 });
}

// Atomically derives the budgets and read models from one observed local launch.
// No network, signer, live launch, or public write path.
export function registerCampaign(db,input,now=Date.now()){
 const {market,originalUnits,treasuryFeeBps,sourceRef,observedThrough}=input;
 if(typeof sourceRef!=='string'||!/^[A-Za-z0-9_:.\/-]{1,160}$/.test(sourceRef))throw Error('Source reference required.');
 const at=timestamp(market.activatedAt),through=timestamp(observedThrough);
 if(at>through||through>now)throw Error('Require completed observation through activation.');
 return transaction(db,()=>{
  const record=importMarket(db,market);
  const fingerprint=sha({market:record,originalUnits,treasuryFeeBps,sourceRef,observedThrough});
  const prior=db.prepare('SELECT * FROM local_campaign_registry WHERE market_id=?').get(record.id);
  if(prior){if(prior.approved_digest!==fingerprint)throw Error('Conflicting launch evidence.');return JSON.parse(prior.receipt);}
  const day=localCalendar.format(at);
  if(db.prepare('SELECT 1 FROM local_campaign_registry WHERE sydney_day=?').get(day))throw Error('A launch already occupies this Sydney day.');
  const seasons=seasonsAt(db,at),weight=createSeasonSnapshot({activatedAt:BigInt(at/1000),
   seasons:seasons.map(s=>({...s,startsAt:BigInt(timestamp(s.startsAt)/1000)}))}).activeWeight;
  const budget=launchAllocations({supply:BigInt(originalUnits),activeSeasonWeight:weight});
  const vault=recordVaultManifest(db,{marketId:record.id,originalUnits,seasons});
  addCampaign(db,{tokenId:record.id,activationMs:at,originalUnits});
  seedFarm(db,{marketId:record.id,originalUnits,treasuryFeeBps});
  const allocations=Object.fromEntries(Object.entries(budget).map(([k,v])=>[k,String(v)]));
  const receipt={marketId:record.id,activation:record.activatedAt,policyVersion:'prd-1.2',source:'local-fixture',
   sydneyDay:day,originalUnits,allocations,activeSeasonWeight:String(weight),vaultDigest:vault.digest,
   sourceRef,approvedDigest:fingerprint};
  db.prepare('INSERT INTO local_campaign_registry VALUES(?,?,?,?,?,?)').run(record.id,day,fingerprint,sourceRef,through,JSON.stringify(receipt));
  return receipt;
 });
}

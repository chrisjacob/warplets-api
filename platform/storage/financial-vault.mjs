import {sql} from './atomic-driver.mjs';
import {canonicalJson} from '../security/canonical.mjs';
const id=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value);
const clock=value=>Number.isSafeInteger(value)&&value>=0&&value<=8640000000000000;
const frozen=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))frozen(child);Object.freeze(value);}return value;};
const visible="(c.id IS NULL OR (c.reveal_ms IS NOT NULL AND c.reveal_ms<=?))";
const assetColumns=`a.id,CASE WHEN ${visible} THEN a.coords ELSE NULL END coords,a.owner,a.latest_ms,
 CASE WHEN c.id IS NULL THEN 0 ELSE 1 END collection_tracked,c.reveal_ms`;
const asset=r=>r?{id:r.id,coords:r.coords,owner:r.owner,latestMs:r.latest_ms,collectionTracked:r.collection_tracked===1,revealMs:r.reveal_ms}:null;
export class FinancialVaultReadBoundError extends RangeError {constructor(){super('Vault read exceeds 2 MiB.');this.code='read_byte_bound';this.status=503;}}
function bounded(rows){if(new TextEncoder().encode(JSON.stringify(rows)).length>2*1024*1024)throw new FinancialVaultReadBoundError();return rows;}
const revision=rows=>{if(!rows[0]||typeof rows[0].revision!=='string'||!/^(0|[1-9][0-9]*)$/.test(rows[0].revision))throw Error('Missing Vault source revision.');return rows[0].revision;};
function query(value,identity){const q=JSON.parse(canonicalJson(value));if(Object.keys(q).length!==3||!Object.hasOwn(q,identity)||!Object.hasOwn(q,'after')||!Object.hasOwn(q,'evaluatedAtMs')||!id(q[identity])||typeof q.after!=='string'||q.after!==''&&!id(q.after)||!clock(q.evaluatedAtMs))throw new TypeError('Invalid bounded Vault query.');return q;}

/** Each load is one atomic read batch. Cursor decoding and the final source
 * revision check belong to the application service, never a SQL callback. */
export function createFinancialVaultRepository(driver){return Object.freeze({
 async readMemberVault(value){
  const q=query(value,'wallet'),[version,page,assets,manifests,claims]=bounded(await driver.batch([
   sql("SELECT CAST(revision AS TEXT) revision FROM app_revisions WHERE name='source'"),
   sql(`SELECT a.id,(SELECT o.observed_ms FROM vault_observations o WHERE o.asset_id=a.id AND o.kind IN ('bind','transfer') ORDER BY o.observed_ms DESC,o.rowid DESC LIMIT 1) owner_observed_ms
    FROM vault_assets a WHERE a.owner=? AND a.id>? ORDER BY a.id LIMIT 26`,q.wallet,q.after),
   sql(`SELECT ${assetColumns} FROM vault_assets a LEFT JOIN collect_assets c ON c.id=a.id WHERE a.owner=? ORDER BY a.id LIMIT 101`,q.evaluatedAtMs,q.wallet),
   sql('SELECT * FROM vault_manifests WHERE activated_ms<=? ORDER BY id LIMIT 101',q.evaluatedAtMs),
   sql(`WITH bounded_assets AS (SELECT id FROM vault_assets WHERE owner=? ORDER BY id LIMIT 101),
    bounded_manifests AS (SELECT id FROM vault_manifests WHERE activated_ms<=? ORDER BY id LIMIT 101)
    SELECT t.asset_id,t.launch_id,t.claimed FROM vault_claim_totals t JOIN bounded_assets a ON a.id=t.asset_id JOIN bounded_manifests m ON m.id=t.launch_id
    WHERE (SELECT COUNT(*) FROM bounded_assets)<=100 AND (SELECT COUNT(*) FROM bounded_manifests)<=100
    ORDER BY t.asset_id,t.launch_id LIMIT 10001`,q.wallet,q.evaluatedAtMs),
  ]));
  return frozen({kind:'member',...q,sourceRevision:revision(version.rows),page:page.rows.map(r=>({id:r.id,ownerObservedMs:r.owner_observed_ms})),assets:assets.rows.map(asset),manifests:manifests.rows,
   claims:claims.rows.map(r=>({assetId:r.asset_id,launchId:r.launch_id,claimed:r.claimed}))});
 },
 async readAssetVault(value){
  const q=query(value,'assetId'),[version,assets,observations,manifests]=bounded(await driver.batch([
   sql("SELECT CAST(revision AS TEXT) revision FROM app_revisions WHERE name='source'"),
   sql(`SELECT ${assetColumns} FROM vault_assets a LEFT JOIN collect_assets c ON c.id=a.id WHERE a.id=?`,q.evaluatedAtMs,q.assetId),
   sql("SELECT observed_ms FROM vault_observations WHERE asset_id=? AND kind IN ('bind','transfer') ORDER BY observed_ms DESC,rowid DESC LIMIT 1",q.assetId),
   sql(`SELECT m.*,COALESCE(t.claimed,'0') claimed FROM vault_manifests m LEFT JOIN vault_claim_totals t ON t.launch_id=m.id AND t.asset_id=?
    WHERE m.id>? AND m.activated_ms<=? AND EXISTS(SELECT 1 FROM vault_assets a LEFT JOIN collect_assets c ON c.id=a.id WHERE a.id=? AND ${visible}) ORDER BY m.id LIMIT 26`,q.assetId,q.after,q.evaluatedAtMs,q.assetId,q.evaluatedAtMs),
  ]));
  return frozen({kind:'asset',...q,sourceRevision:revision(version.rows),asset:asset(assets.rows[0]),ownerObservedMs:observations.rows[0]?.observed_ms??null,manifests:manifests.rows});
 },
});}

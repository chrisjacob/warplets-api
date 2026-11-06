import {canonicalJson,utf8} from '../security/canonical.mjs';
import {RECOVERY_V2_LIMITS} from '../recovery/v2-codec.mjs';
import {createVaultRecoveryReader} from './archive-index-reader.mjs';
import {createVaultLiabilityManifest} from './manifest.mjs';

const need=(v,m)=>{if(!v)throw new Error('Vault recovery manifest: '+m);};
/** Reads one explicitly selected page through independently pinned v2 index
 * paths. This binds liabilities to retained bytes; it does not restore claims
 * or assert that the entire recovery graph has passed semantic validation. */
export async function vaultLiabilityFromRecoveryPage({rootBytes,rootDigest,marketId,pageIndex},{crypto,store}){
 need(typeof marketId==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(marketId),'market identity');
 need(Number.isInteger(pageIndex)&&pageIndex>=0&&pageIndex<RECOVERY_V2_LIMITS.objects,'page index');
 const {codec,root,bytes,lookup}=await createVaultRecoveryReader({rootBytes,rootDigest},{crypto,store});
 const rawTable=await lookup(root.tables,'tables','vault_manifests');need(rawTable,'Vault table absent');
 const table=await codec.verifyTableDescriptor(rawTable);
 need(canonicalJson(table.columns)===canonicalJson(['id','activated_ms','genesis_units','season_units','original_units','seasons','digest'])&&table.hasRowid===true,'Vault schema');
 const entry=await lookup(table.pages,'table-pages',String(pageIndex).padStart(10,'0'));need(entry,'Vault page absent');
 const page=await codec.verifyRows(await bytes(entry.identity,RECOVERY_V2_LIMITS.pageBytes),entry.identity);
 need(page.table===table.name&&page.index===pageIndex&&page.index===entry.index&&page.hasRowid===table.hasRowid&&canonicalJson(page.columns)===canonicalJson(table.columns)&&canonicalJson(page.after)===canonicalJson(entry.after)&&page.rows.length===entry.rowCount&&canonicalJson([page.rows.at(-1)[0]])===canonicalJson(entry.last),'Vault page binding');
 const rows=page.rows.filter(r=>r[1]===marketId);need(rows.length===1,'market absent or duplicated in selected page');
 const [,id,activatedMs,genesisUnits,seasonUnits,originalUnits,seasonsJson,sourceDigest]=rows[0],seasons=JSON.parse(seasonsJson);
 need(Array.isArray(seasons)&&seasons.length<=12&&seasons.every(s=>s&&Object.keys(s).sort().join(',')==='id,levels,startsAt'&&typeof s.startsAt==='string'&&Number.isSafeInteger(Date.parse(s.startsAt))&&new Date(Date.parse(s.startsAt)).toISOString()===s.startsAt),'original Season snapshot shape and time');
 need(await crypto.sha256(utf8(JSON.stringify([id,activatedMs,originalUnits,seasons])))===sourceDigest,'original Vault snapshot digest');
 const built=await createVaultLiabilityManifest(utf8(canonicalJson({marketId:id,activatedMs,originalUnits,inventoryCommitment:rootDigest,
  seasons:seasons.map(s=>({id:s.id,startsMs:Date.parse(s.startsAt),levels:s.levels}))})),{crypto});
 need(built.manifest.genesis.budgetUnits===genesisUnits&&built.manifest.season.budgetUnits===seasonUnits,'source budgets mismatch');
 return {...built,source:{recoveryDigest:rootDigest,tableDigest:table.tableDigest,pageDigest:entry.identity.byteDigest,pageIndex,sourceDigest},
  verification:'pinned-liability-page-only',fullRecoveryVerified:false,financialExecution:false};
}

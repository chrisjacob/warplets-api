import {canonicalJson,utf8} from '../security/canonical.mjs';
import {projectMemberVaultSnapshot,projectVaultAssetSnapshot} from '../vault/read-projection.mjs';
import {describeFarm} from '../stake/projection.mjs';
import {decodeReadCursor,encodeReadCursor,FinancialReadError,requireRead} from './cursor.mjs';
const id=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value);
const status=Object.freeze({sourceStatus:'local-accounting',chainAuthority:'unverified',unit:'base-units',executable:false});
function wallet(principal){requireRead(principal?.kind==='wallet'&&id(principal.wallet),'authentication_required','Connect your wallet.',401);return principal.wallet;}
function farm(row,events,at,owner=null){
 requireRead(events.length<=1000,'event_bound','Complete farm history exceeds the local read bound.');
 try{return {...describeFarm(row,at,owner,events),...status};}catch{throw new FinancialReadError('invalid_accounting','Farm accounting could not be verified.');}
}
export function createFinancialReadService({vaultRepository,farmRepository,crypto,clock}){
 async function read(scope,subject,cursor,load,project){
  const context=decodeReadCursor(cursor,{scope,subject,nowMs:clock.nowMs()});
  for(let attempt=0;attempt<2;attempt++){
   const snapshot=await load(context),revision=snapshot.sourceRevision;
   requireRead(context.sourceRevision===null||context.sourceRevision===revision,'stale_cursor','Ownership, reveal or accounting changed. Restart this view.',409);
   const value=project(snapshot),snapshotId=await crypto.sha256(utf8(canonicalJson(['financial-read-v1',scope,subject,revision,context.evaluatedAtMs])));
   const current=await farmRepository.sourceRevision();
   if(current!==revision){
    requireRead(context.sourceRevision===null,'stale_cursor','The source changed during this page. Restart this view.',409);
    continue;
   }
   requireRead(clock.nowMs()>=context.evaluatedAtMs,'invalid_read_clock','Financial read clock moved backward.');
   return {...value,snapshotId,sourceRevision:revision,nextCursor:value.nextCursor?encodeReadCursor({scope,subject,sourceRevision:revision,evaluatedAtMs:context.evaluatedAtMs,after:value.nextCursor}):null};
  }
  throw new FinancialReadError('source_changed','Financial source changed during verification. Retry shortly.');
 }
 return Object.freeze({
  async readMemberVault(principal,{cursor}={}){const owner=wallet(principal);
   return read('owner-vault',owner,cursor,c=>vaultRepository.readMemberVault({wallet:owner,after:c.after,evaluatedAtMs:c.evaluatedAtMs}),projectMemberVaultSnapshot);
  },
  async readAssetVault(assetId,{cursor}={}){requireRead(id(assetId),'invalid_asset','Invalid NFT identity.',400);
   return read('asset-vault',assetId,cursor,c=>vaultRepository.readAssetVault({assetId,after:c.after,evaluatedAtMs:c.evaluatedAtMs}),snapshot=>{
    const result=projectVaultAssetSnapshot(snapshot);
    requireRead(result.kind!=='missing','asset_not_found','Unknown NFT.',404);
    requireRead(result.kind!=='hidden','metadata_unrevealed','Vault detail becomes available after reveal.',409);
    requireRead(result.kind==='ready',result.reason??'invalid_accounting','Complete NFT accounting is unavailable.');return result.value;
   });
  },
  async readFarm(marketId){requireRead(id(marketId),'invalid_market','Invalid market identity.',400);
   const result=await read('farm',marketId,undefined,c=>farmRepository.readFarm({marketId,evaluatedAtMs:c.evaluatedAtMs}),snapshot=>{
    requireRead(snapshot.farm,'farm_not_found','Unknown local farm.',404);return farm(snapshot.farm,snapshot.events,snapshot.evaluatedAtMs);
   });
   const {nextCursor,...value}=result;return value;
  },
  async readPositions(principal,{cursor}={}){const owner=wallet(principal);
   return read('owner-farms',owner,cursor,c=>farmRepository.readPositions({wallet:owner,after:c.after,evaluatedAtMs:c.evaluatedAtMs}),snapshot=>{
    const page=snapshot.farms.slice(0,25),byMarket=new Map(page.map(row=>[row.market_id,[]]));
    for(const event of snapshot.events){requireRead(byMarket.has(event.market_id),'invalid_accounting','Farm history belongs to another market.');byMarket.get(event.market_id).push(event);}
    return {items:page.map(row=>farm(row,byMarket.get(row.market_id),snapshot.evaluatedAtMs,owner)),nextCursor:snapshot.farms.length>25?page[24].market_id:null,
     asOf:new Date(snapshot.evaluatedAtMs).toISOString(),source:'local-fixture',...status};
   });
  },
 });
}

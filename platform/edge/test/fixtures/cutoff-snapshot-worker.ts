// Test-only synthetic snapshot endpoint. All objects stay in local private R2.
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {createCutoffSnapshotRepository} from '../../../storage/cutoff-snapshot.mjs';
import {createCutoffSnapshotService} from '../../../earn/snapshot.mjs';
import type {PrivateSnapshotReferences} from '../../../earn/snapshot.mjs';
import type {CutoffInventoryQuery} from '../../../storage/cutoff-inventory.mjs';
import type {OperatorPrincipal} from '../../../application/ports';
import {createAtomicSettlementRepository} from '../../../storage/atomic-settlement.mjs';
import {createArtifactReferenceRepository} from '../../../storage/atomic-artifacts.mjs';
import {createPrivateReferenceService} from '../../../artifacts/reference-service.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
export default {async fetch(request:Request,env:Env){
 if(new URL(request.url).hostname!=='localhost')return new Response('fixture only',{status:403});
 const body=await request.json() as {principal:OperatorPrincipal;query:Omit<CutoffInventoryQuery,'nowMs'>;nowMs:number;fault?:'omit-attempt'|'scope-race'|'lose-response'};
 const base=createD1AtomicDriver(env.DB),cryptoPort=createWebCrypto();let corrected=false,lost=false;
 const driver={...base,async batch(statements:Parameters<typeof base.batch>[0]){
  if(body.fault==='omit-attempt')statements=statements.filter(s=>!s.sql.startsWith('INSERT INTO app_snapshot_attempts'));
  const result=await base.batch(statements);
  if(body.fault==='lose-response'&&!lost&&statements.some(s=>s.sql.startsWith('INSERT INTO app_snapshot_attempts'))){lost=true;throw Error('fixture committed response lost');}
  return result;
 }};
 const ports={crypto:cryptoPort,ids:{next:()=>crypto.randomUUID()},clock:{nowMs:()=>body.nowMs}};
 const references=createPrivateReferenceService({...ports,repository:createArtifactReferenceRepository(driver,ports),store:r2ArtifactStore(env.MANIFESTS)}) as PrivateSnapshotReferences;
 const privateReferences:PrivateSnapshotReferences={async persist(principal,input){
  const result=await references.persist(principal,input);
  if(body.fault==='scope-race'&&!corrected){corrected=true;await base.batch([{sql:"UPDATE app_operator_scopes SET enabled=0,revision=revision+1 WHERE operator=? AND scope='earn-snapshot'",values:[principal.id]}]);}
  return result;
 }};
 const service=createCutoffSnapshotService({...ports,repository:createCutoffSnapshotRepository(driver,ports),settlementRepository:createAtomicSettlementRepository(driver,ports),privateReferences});
 try{return Response.json(await service.assemble(body.principal,body.query));}
 catch(error){return Response.json({error:String(error)},{status:500});}
}};

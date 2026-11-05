import {createAtomicSettlementRepository} from '../storage/atomic-settlement.mjs';
import {createSettlementPreparationRepository} from '../storage/settlement-preparation.mjs';
import {createEarnSettlementService} from '../earn/settlement-service.mjs';
import {createPreparedSettlementHandler} from '../jobs/prepared-settlement-handler.mjs';
import {createSettlementScheduler} from '../jobs/settlement-scheduler.mjs';
import {createJobRepository} from '../jobs/repository.mjs';
import {createHandlerRegistry} from '../jobs/handlers.mjs';
import {reconcileJobOutbox} from '../jobs/outbox.mjs';
import {runTick} from '../jobs/runner.mjs';
import {createCutoffSnapshotRepository} from '../storage/cutoff-snapshot.mjs';
import {createCutoffFreezeRepository} from '../storage/cutoff-freeze.mjs';
import {createArtifactReferenceRepository} from '../storage/atomic-artifacts.mjs';
import {createPrivateReferenceService} from '../artifacts/reference-service.mjs';
import {createCutoffSnapshotService} from '../earn/snapshot.mjs';
import {createSnapshotHandler,cutoffJobKey} from '../jobs/snapshot-handler.mjs';
import {createJobCommand} from '../jobs/model.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {nat} from '../earn/validation.mjs';
import {createSettlementReconciler} from '../earn/settlement-reconciliation.mjs';
// Explicit local composition. No fetch/cron registration or external reader.
export function createLocalSettlementContext({driver,artifacts,crypto,ids,clock,principal}){
 principal=JSON.parse(canonicalJson(principal));
 const ports={crypto,ids,clock,principal},repository=createAtomicSettlementRepository(driver,ports),jobs=createJobRepository(driver,ports);
 const service=createEarnSettlementService({repository:createSettlementPreparationRepository(driver,ports),artifacts,crypto,clock});
 const handler=createPreparedSettlementHandler({service,repository,crypto,clock,principal});
 const privateReferences=createPrivateReferenceService({...ports,store:artifacts,repository:createArtifactReferenceRepository(driver,ports)});
 const snapshotService=createCutoffSnapshotService({...ports,repository:createCutoffSnapshotRepository(driver,ports),settlementRepository:repository,privateReferences});
 const snapshotHandler=createSnapshotHandler({...ports,service:snapshotService,freezeRepository:createCutoffFreezeRepository(driver,ports),store:artifacts});
 const handlers=createHandlerRegistry({'complete-cutoff':snapshotHandler,'finalize-board':handler,'allocate-token-day':handler});
 return Object.freeze({service,repository,jobs,scheduler:createSettlementScheduler(driver,ports),
  reconciler:createSettlementReconciler({...ports,driver,artifacts}),
  async scheduleCutoff(query){
   query=JSON.parse(canonicalJson(query));nat(query.epoch,'epoch');
   const bytes=utf8(canonicalJson(query));if(bytes.length>256*1024)return {kind:'pending',reason:'snapshot-configuration-bound'};
   const byteDigest=await crypto.sha256(bytes),identity={key:'private/'+byteDigest+'.json',byteDigest,size:bytes.length,semanticDigest:null,visibility:'private',contentType:'application/json'};
   const stored=await privateReferences.persist(principal,{identity,bytes,requestKey:byteDigest});
   if(!['committed','replayed'].includes(stored.kind))return stored;
   const key=cutoffJobKey(query.epoch,byteDigest);
   return jobs.enqueue(await createJobCommand({principal,requestKey:key,nowMs:clock.nowMs(),input:{businessKey:key,sourceKey:key,type:'complete-cutoff',
    payload:{principal,configuration:identity},readyMs:(query.epoch+1)*86400000,maxAttempts:5}},crypto));
  },
  tick:({deadlineMs=5000}={})=>runTick({repository:jobs,clock,handlers,limit:1,deadlineMs,outbox:bounds=>reconcileJobOutbox(driver,jobs,bounds)})});
}

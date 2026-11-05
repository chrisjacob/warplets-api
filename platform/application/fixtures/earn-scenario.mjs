// Sanitized deterministic counterpart of earn/archive.test.mjs. The pinned JSON
// was captured before extraction; this builder now drives the injected service.
import { DAY_MS } from '../../domain/earn/index.mjs';
import { addCampaign, recordStakeRead } from '../../earn/workflow.mjs';
import { recordOwnership } from '../../earn/components.mjs';
import { exportBoard, proofForWallet } from '../../earn/archive.mjs';
import { commitment } from '../../earn/commitments.mjs';
import { appendAudit, configCheckpoint } from '../../operations/audit.mjs';
import { createNodeEarnService } from '../node-context.mjs';
import { samplePolicy } from '../../pricing/fixtures.mjs';
import { registerPriceSource } from '../../pricing/evidence.mjs';
export async function buildGoldenScenario(db,{beforeFinalize,wallets=['w3','w1','w2']}={}) {
  const epoch=20001,start=epoch*DAY_MS,cutoff=start+DAY_MS-1;
  addCampaign(db,{tokenId:'A',activationMs:start,originalUnits:'1000000'});
  registerPriceSource(db,{...samplePolicy('A'),registeredAtMs:start});
  for(const wallet of wallets) {
    const read={wallet,tokenId:'A',microUsd:'10000000',sourceRef:'synthetic-position-'+wallet};
    recordStakeRead(db,{...read,observedMs:start,expiresMs:start});
    const service=createNodeEarnService(db,{nowMs:start,ids:{next:()=> 'submission-'+wallet}});
    const post=(await service.submitContent({kind:'wallet',wallet},{tokenId:'A',requestKey:'synthetic-key-'+wallet,
      url:'https://example.test/posts/'+wallet})).submission;
    await service.recordFinalReview({kind:'operator',id:'synthetic-reviewer'},{submissionId:post.id,score:7,reason:'Synthetic assessment',sourceRef:'synthetic-review'});
    recordStakeRead(db,{...read,observedMs:cutoff,expiresMs:cutoff});
    recordOwnership(db,{wallet,epoch,asOfMs:cutoff,assets:[],sourceRef:'synthetic-owner'});
  }
  if(beforeFinalize)await beforeFinalize({epoch,nowMs:cutoff+1,sourceRef:'synthetic-reconciliation',sourceComplete:true});
  await createNodeEarnService(db,{nowMs:cutoff+1}).finalizeBoard({epoch,sourceRef:'synthetic-reconciliation',sourceComplete:true});
  await createNodeEarnService(db,{nowMs:start+DAY_MS}).recordAllocation({tokenId:'A',day:2});
  const bundle=exportBoard(db,epoch);
  const auditHead=appendAudit(db,{category:'synthetic',entity:'golden-vector',changeKey:'v1',atMs:start,
    actor:'synthetic-operator',evidenceRef:'synthetic-only',payload:{b:2,a:'golden'}});
  return {epoch,start,cutoff,bundle,allocationDigest:commitment('allocation',bundle.manifest.allocations[0]),
    proofs:['w1','w2','w3'].map(wallet=>proofForWallet(db,{wallet,tokenId:'A',day:2})),auditHead,configCheckpoint:configCheckpoint(db)};
}

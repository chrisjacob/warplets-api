import {randomUUID,createHash} from 'node:crypto';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createCollectionStateCodec} from '../collect/state-codec.mjs';
import {createCollectionSourceIntake} from '../collect/source-intake.mjs';
import {createCollectionSourceRepository} from '../collect/source-repository.mjs';
import {createEligibilityIndexService} from '../collect/eligibility-index-service.mjs';
import {createEligibilityIndexRepository} from '../collect/eligibility-index-repository.mjs';
import {createGovernancePlanning} from '../application/collection-governance.mjs';
import {createGovernanceOperatorService} from './operator-service.mjs';
import {createGovernanceOperatorRepository} from './operator-repository.mjs';
import {measureBatch} from '../storage/atomic-driver.mjs';
import {encode58} from '../server/base58.mjs';
export const GOVERNANCE_OPERATOR={kind:'operator',id:'synthetic-governance-operator'},GOVERNANCE_OPEN=20001*86400000;
export function governanceWallets(count){return Array.from({length:count},(_,n)=>{const b=Buffer.alloc(32,127);b.writeUInt32BE(n,28);return encode58(b);}).sort();}
/** Node-only synthetic setup. Public product composition never imports this. */
export async function governanceOperatorFixture(t,{holders=governanceWallets(3),nextWhitelist=governanceWallets(4).slice(2),union=[...new Set([...holders,...nextWhitelist])].sort(),wrap=base=>base,index=true}={}){
 const db=openDatabase();t.after(()=>db.close());const crypto=createNodeCrypto(),ids={next:randomUUID};let now=GOVERNANCE_OPEN+1;
 db.function('governance_operator_clock',()=>now);const base={...createNodeAtomicDriver(db),leaseNowSql:'governance_operator_clock()'},ports={crypto,ids,clock:{nowMs:()=>now}};
 for(const scope of ['collection-import','governance-publication','governance-decision'])db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(GOVERNANCE_OPERATOR.id,scope);
 const codec=createCollectionStateCodec({crypto}),groups=await Promise.all([holders,nextWhitelist,union].map(wallets=>codec.encodeWalletList(wallets))),records=new Map(),lists=new Map(),pages=new Map();
 for(const group of groups){records.set(group.manifest.id,group.manifest);lists.set(group.manifest.id,group.manifest);for(const page of group.pages){records.set(page.id,page);pages.set(page.id,page);}}
 const intake=createCollectionSourceIntake({...ports,repository:createCollectionSourceRepository(base,ports)}),indexer=createEligibilityIndexService({...ports,repository:createEligibilityIndexRepository(base,ports)});
 for(const record of records.values()){const result=await intake.stageRecord(GOVERNANCE_OPERATOR,{record,requestKey:record.id});if(result.kind!=='committed')throw Error(JSON.stringify(result));}
 for(const list of lists.values()){const result=await intake.sealList(GOVERNANCE_OPERATOR,{id:list.id,requestKey:list.id});if(result.kind!=='committed')throw Error(JSON.stringify(result));}
 if(index)for(const page of pages.values()){const result=await indexer.materializePage(GOVERNANCE_OPERATOR,{id:page.id,requestKey:page.id});if(result.kind!=='committed')throw Error(JSON.stringify(result));}
 const measurements=[],driver=wrap({...base,async batch(statements){measurements.push(measureBatch(statements));return base.batch(statements);}},db,value=>now=value),repository=createGovernanceOperatorRepository(driver,ports),service=createGovernanceOperatorService({...ports,repository});
 const sourceId='synthetic-frozen-groups',input={ballotId:'synthetic-operator-ballot',opensMs:GOVERNANCE_OPEN,previousTrancheOpeningMs:GOVERNANCE_OPEN-86400000,electorateSourceId:sourceId,electorateDigest:await createGovernancePlanning({crypto}).electorateDigest({sourceId,cutoffMs:GOVERNANCE_OPEN,holders,nextWhitelist}),cutoffMs:GOVERNANCE_OPEN,sourceKind:'synthetic-local-operator-fixture',holdersListId:groups[0].manifest.id,nextWhitelistListId:groups[1].manifest.id,unionListId:groups[2].manifest.id};
 return {db,base,ports,service,repository,indexer,groups,pages,holders,nextWhitelist,union,input,measurements,setNow:value=>now=value,getNow:()=>now,publish:(changes={},key='publish')=>service.publishBallot(GOVERNANCE_OPERATOR,{input:{...input,...changes},requestKey:key}),decision:(changes={},key='decision')=>service.recordDecision(GOVERNANCE_OPERATOR,{input:{ballotId:input.ballotId,choice:'7',decidedMs:GOVERNANCE_OPEN+2*86400000,noticeMs:GOVERNANCE_OPEN,rationale:'Synthetic founder rationale.',...changes},requestKey:key}),expectedHash:createHash('sha256').update(JSON.stringify([input.ballotId,input.opensMs,input.previousTrancheOpeningMs,union])).digest('hex')};
}

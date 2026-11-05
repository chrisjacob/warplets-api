import {randomUUID} from 'node:crypto';
import {createNodeCrypto} from '../../security/node-crypto.mjs';
import {createNodeAtomicDriver} from '../../storage/node/atomic-driver.mjs';
import {createEvidenceRepository} from '../../evidence/repository.mjs';
import {createEvidenceService} from '../../evidence/service.mjs';
import {createArtifactReferenceRepository} from '../../storage/atomic-artifacts.mjs';
import {createQuoteRepository} from '../../quotes/repository.mjs';
import {createQuoteService} from '../../quotes/service.mjs';
import {quoteProvenanceFixture} from './quote-provenance.mjs';
/** Actual retained B04 provenance for explicitly synthetic browser previews. */
export async function seedBoundQuote(db,store,{now=Date.now(),marketId='quote-demo'}={}){
 const crypto=createNodeCrypto(),fixture=await quoteProvenanceFixture({crypto,now,marketId});fixture.seed(db);
 const principal={kind:'operator',id:'synthetic-quote-fixture'};db.prepare('INSERT OR IGNORE INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'evidence-ingest');
 const driver=createNodeAtomicDriver(db),ports={crypto,ids:{next:randomUUID},clock:{nowMs:()=>now}};
 const evidence=createEvidenceService({repository:createEvidenceRepository(driver,ports),artifactRepository:createArtifactReferenceRepository(driver,ports),store,readers:fixture.readers,...ports});
 const service=createQuoteService({repository:createQuoteRepository(driver,ports),store,...ports});
 for(const result of [await evidence.registerSource(principal,fixture.source),await evidence.ingest(principal,fixture.request()),await service.bind(principal,fixture.bind),await service.materialize(principal,marketId)]){
  if(!['committed','replayed'].includes(result.kind))throw Error('Synthetic quote fixture setup: '+JSON.stringify(result));
 }
 return {fixture,service};
}

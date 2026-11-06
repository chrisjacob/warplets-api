import assert from 'node:assert/strict';
import {economicFixture,economicPrincipal,driveEconomics} from './legacy-economic-repository.fixtures.mjs';
import {createLegacyAdoptionPreparation} from './legacy-adoption-preparation.mjs';
import {createLegacyAdoptionActivation} from './legacy-adoption-activation.mjs';
export {economicPrincipal as adoptionPrincipal};
export async function preparedAdoptionFixture(t,options={}){
 const f=await economicFixture(t,{count:1,...options,prepareParent:false});
 for(const scope of ['collection-publication','collection-founder'])f.db.prepare('INSERT OR IGNORE INTO app_operator_scopes VALUES(?,?,0,1)').run(economicPrincipal.id,scope);
 if(options.beforeParents)await options.beforeParents(f);
 await f.prepareParents();assert.equal((await driveEconomics(f,await f.economics.start(economicPrincipal,f.economicInput))).kind,'economic-ready');
 const preparation=createLegacyAdoptionPreparation(f.economicPorts),input={adoptionId:options.inventoryId?'adoption-'+options.inventoryId:'synthetic-genuine-preparation',economicAuditId:f.economicInput.auditId};let r=await preparation.start(economicPrincipal,input);
 for(let n=0;n<10000&&['started','progress','replayed'].includes(r.kind);n++)r=await preparation.step(economicPrincipal,{adoptionId:input.adoptionId,expectedRevision:r.revision});assert.equal(r.kind,'prepared',JSON.stringify(r));
 const metrics=[],activationPorts={...f.economicPorts,driver:{...f.driver,leaseNowSql:String(f.economicPorts.clock.nowMs())},onMeasure:m=>metrics.push(m)},activation=createLegacyAdoptionActivation(activationPorts);
 return {...f,activationPorts,activation,metrics,preparationResult:r,activationInput:{adoptionId:input.adoptionId,requestKey:options.inventoryId?'activate-'+options.inventoryId:'activate-synthetic-prepared-source'}};
}

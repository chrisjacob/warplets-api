import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {createInventoryReadRepository} from '../../../collect/inventory-read-model.mjs';
import {createMintReservationRepository} from '../../../collect/mint-repository.mjs';
import {createMintReservationService} from '../../../collect/mint-service.mjs';
import {createStagePublicationRepository} from '../../../collect/stage-repository.mjs';
import {createStagePublicationService} from '../../../collect/stage-service.mjs';
import {measureBatch} from '../../../storage/atomic-driver.mjs';
export default {async fetch(request:Request,env:{DB:D1Database}){
 if(new URL(request.url).pathname!=='/__fixture'||request.method!=='POST')return new Response('Not found',{status:404});
 try{const b=await request.json() as any,base=createD1AtomicDriver(env.DB),metrics={sql:0,maxBatchBytes:0,maxParameters:0};let hit=false;
 const driver={...base,leaseNowSql:String(b.nowMs),async batch(statements:any[]){const m=measureBatch(statements);metrics.sql+=statements.length;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,m.batchBytes);metrics.maxParameters=Math.max(metrics.maxParameters,m.maxParameters);
 if(!hit&&statements.some(s=>s.sql.startsWith('INSERT INTO collect_operations'))){hit=true;if(b.fault==='watermark')await env.DB.prepare('UPDATE app_recovery_watermark SET revision=revision+1').run();if(b.fault==='omit-admission')statements=statements.map(s=>s.sql.startsWith('INSERT INTO app_collection_mint_admissions')?{sql:'SELECT 1 omitted',values:[]}:s);}
 return base.batch(statements);}},crypto=createWebCrypto(),ports={crypto,clock:{nowMs:()=>b.nowMs},ids:{next:()=>globalThis.crypto.randomUUID()}},reads=createInventoryReadRepository(driver,{crypto,normalizedAdmissionAvailable:true}),mint=createMintReservationService({crypto,repository:createMintReservationRepository(driver,ports)}),stages=createStagePublicationService({crypto,repository:createStagePublicationRepository(driver,ports)});
 const result=b.method==='mint'?await mint.reserveMint(b.principal,b.input):b.method==='stage'?await stages.publishStage(b.principal,b.input):b.method==='list'?await reads.listInventories(b.input):await reads.readInventory(b.input);return Response.json({result,metrics});
 }catch(error){return Response.json({error:String(error)},{status:409});}
}};

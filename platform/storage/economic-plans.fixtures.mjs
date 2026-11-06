// Synthetic fixture with real B04 receipts and guarded065 commands; no remote data.
import {randomUUID} from 'node:crypto';
import {openDatabase} from './database.mjs';
import {createNodeAtomicDriver} from './node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {memoryArtifacts} from '../recovery/fixtures.mjs';
import {seedBoundQuote} from '../application/fixtures/seed-bound-quote.mjs';
import {createQuoteRepository} from '../quotes/repository.mjs';
import {createQuoteService} from '../quotes/service.mjs';
import {createSwapPlanService} from '../transactions/swap-plan-service.mjs';
import {createEconomicPlanRepository,PREPARE_ECONOMIC_PLAN} from './economic-plans.mjs';
const base=createNodeCrypto(),at=Date.UTC(2026,10,5,12),principal={kind:'wallet',wallet:'11111111111111111111111111111111'};
export const economicPlanRequest=()=>({principal,intentKey:'trade-1',requestKey:'request-1',request:{format:'10x.action-request.v1',action:'swap',parameters:{marketId:'persist-swap',direction:'buy-att',inputUnits:'1000000',slippageBps:50},maximumFeeUnits:'10000'}});
export async function economicPlanFixture(t){const db=openDatabase();t.after(()=>db.close());const store=memoryArtifacts();await seedBoundQuote(db,store,{now:at,marketId:'persist-swap'});let now=at+20,fault=null,hit=0;db.function('synthetic_economic_now',()=>now);const raw={...createNodeAtomicDriver(db),leaseNowSql:'synthetic_economic_now()'};
 const driver={...raw,async batch(statements){const committing=statements.some(s=>s.sql.startsWith('INSERT INTO app_economic_preparations'));if(committing){
  if(fault==='omit-intent')statements=statements.filter(s=>!s.sql.startsWith('INSERT INTO app_economic_intents'));
  if(fault==='omit-preparation')statements=statements.filter(s=>!s.sql.startsWith('INSERT INTO app_economic_preparations'));
  if(fault==='clock'){now=at+30001;hit++;}
  if(fault==='source'){db.prepare("UPDATE market_fixtures SET body=json_set(body,'$.fixtureRace',1) WHERE id='persist-swap'").run();hit++;}
  if(fault==='generation'){db.prepare("UPDATE app_recovery_state SET generation='changed' WHERE id=1").run();hit++;}
 }const result=await raw.batch(statements);if(committing&&fault==='lose'){hit++;throw Error('Synthetic lost committed response');}return result;}};
 const ports={crypto:base,ids:{next:randomUUID},clock:{nowMs:()=>now}},quotes=createQuoteRepository(driver,ports),service=createQuoteService({...ports,repository:quotes,store}),swapPlans=createSwapPlanService({...ports,quoteRepository:quotes,quoteService:service}),repo=createEconomicPlanRepository(driver,{...ports,swapPlans,quoteRepository:quotes});
 return {db,repo,store,driver,crypto:base,clock:ports.clock,nowMs:at+20,principal,setNow:v=>now=v,setFault:v=>fault=v,get hit(){return hit;},counts(){return {...db.prepare(`SELECT (SELECT count(*) FROM app_economic_intents) intents,(SELECT count(*) FROM app_economic_preparations) preparations,(SELECT count(*) FROM app_command_receipts WHERE operation_kind='${PREPARE_ECONOMIC_PLAN}') receipts`).get()};}};}

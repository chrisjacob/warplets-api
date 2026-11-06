import { randomUUID } from 'node:crypto';
import { createApplicationContext, deferredPort } from './context.mjs';
import { createNodeCrypto } from '../security/node-crypto.mjs';
import { createNodeEarnRepository } from '../storage/node/earn-repository.mjs';
import { createEarnService } from '../earn/service.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createAtomicEarnRepository} from '../storage/atomic-earn.mjs';
import {createAtomicActionRepository} from '../storage/atomic-actions.mjs';
import {createEarnReadRepository} from '../storage/earn-reads.mjs';
import {createGuardedEarnService} from '../earn/guarded-service.mjs';
import {createQuoteRepository} from '../quotes/repository.mjs';
import {createQuoteService} from '../quotes/service.mjs';
import {createFinancialVaultRepository} from '../storage/financial-vault.mjs';
import {createFinancialFarmRepository} from '../storage/financial-farms.mjs';
import {createFinancialReadService} from '../financial/service.mjs';
import {createGovernanceRepository} from '../governance/repository.mjs';
import {createGovernanceReadModel} from '../governance/read-model.mjs';
import {createGovernanceService} from './governance-service.mjs';
export function createNodeGovernanceService(db,{clock={nowMs:Date.now},ids={next:randomUUID}}={}){
 const driver=createNodeAtomicDriver(db),crypto=createNodeCrypto();
 return createGovernanceService({repository:createGovernanceRepository(driver,{crypto,ids}),reads:createGovernanceReadModel(driver),crypto,clock});
}
export function createNodeFinancialReadService(db,{clock={nowMs:Date.now}}={}){
 const driver=createNodeAtomicDriver(db);return createFinancialReadService({vaultRepository:createFinancialVaultRepository(driver),farmRepository:createFinancialFarmRepository(driver),crypto:createNodeCrypto(),clock});
}
export function createNodeQuoteService(db,{clock={nowMs:Date.now},store={async getVerified(identity){return {status:'missing',identity};}},ids={next:randomUUID}}={}){
 const crypto=createNodeCrypto(),repository=createQuoteRepository(createNodeAtomicDriver(db),{crypto,ids});
 return createQuoteService({repository,store,crypto,clock});
}
export function createNodeGuardedEarnService(db,{nowMs,ids={next:randomUUID}}){
 const driver=createNodeAtomicDriver(db),ports={crypto:createNodeCrypto(),clock:{nowMs:()=>nowMs},ids};
 return createGuardedEarnService({guarded:createAtomicEarnRepository(driver,ports),reads:createEarnReadRepository(driver),actions:createAtomicActionRepository(driver,ports),...ports});
}
export function createNodeEarnService(db,{nowMs,ids={next:randomUUID}}) {
  return createEarnService(createApplicationContext({clock:{nowMs:()=>nowMs},ids,crypto:createNodeCrypto(),
    repositories:{earn:createNodeEarnRepository(db,{ids})},evidence:deferredPort(),artifacts:deferredPort(),jobs:deferredPort(),
    telemetry:{record(){}},executionPolicy:{mode:'local-validation',financialExecution:false}}));
}

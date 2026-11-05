import { randomUUID } from 'node:crypto';
import { createApplicationContext, deferredPort } from './context.mjs';
import { createNodeCrypto } from '../security/node-crypto.mjs';
import { createNodeEarnRepository } from '../storage/node/earn-repository.mjs';
import { createEarnService } from '../earn/service.mjs';
export function createNodeEarnService(db,{nowMs,ids={next:randomUUID}}) {
  return createEarnService(createApplicationContext({clock:{nowMs:()=>nowMs},ids,crypto:createNodeCrypto(),
    repositories:{earn:createNodeEarnRepository(db,{ids})},evidence:deferredPort(),artifacts:deferredPort(),jobs:deferredPort(),
    telemetry:{record(){}},executionPolicy:{mode:'local-validation',financialExecution:false}}));
}

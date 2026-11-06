import {refreshOwnerPaths} from '../nfts/refresh-owner-openapi.mjs';
import { randomUUID } from 'node:crypto';
import { policy } from '../contracts/policy.mjs';
import { authPaths } from './auth-contract.mjs';
import { marketPaths } from '../markets/catalog.mjs';
import { launchPlanPaths } from '../launch/schema.mjs';
import { ballotPaths } from '../governance/ballots.mjs';
import { earnPaths } from '../earn/openapi.mjs';
import { vaultPaths } from '../vault/http.mjs';
import { stakePaths } from '../stake/farms.mjs';
import { txPaths } from '../transactions/http.mjs';
import { shapes, describeResponses } from '../contracts/shapes.mjs';
import { collectPaths } from '../collect/http.mjs';
import { operationsPaths } from '../operations/http.mjs';
import { notificationPaths } from '../notifications/http.mjs';
import { quotePaths } from '../quotes/http.mjs';
import { makeCapabilities } from '../contracts/capabilities.mjs';

export const apiBase = '/api/v1';
const resources = {
  '/capabilities': { id: 'getCapabilities', summary: 'Discover this runtime’s explicitly supported local features and disabled production execution.' },
  '/policy': { id: 'getPolicy', summary: 'Read the published product rules.' },
  '/collections': { id: 'listCollections', summary: 'Read the planned collection terms.' },
  '/health': { id: 'getHealth', summary: 'Check the local API and policy version.' }
};
export function openapi() {
  const paths = Object.fromEntries(Object.entries(resources).map(([path, {id,summary}]) =>
    [path, {get: {operationId:id, summary, responses:{200:{description:summary, content:{'application/json':{schema:{type:'object'}}}}}}}]));
  const routes={...paths,...authPaths,...marketPaths,...launchPlanPaths,...ballotPaths,...earnPaths,...vaultPaths,...stakePaths,...txPaths,...collectPaths,...refreshOwnerPaths,...operationsPaths,...notificationPaths,...quotePaths};
  return {openapi:'3.1.0', info:{title:'10X.MEME validation API',version:policy.version},servers:[{url:apiBase}],
    paths:describeResponses(routes),components:{schemas:shapes}};
}
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {status, headers:{
    'content-type':'application/json; charset=utf-8', 'cache-control':'no-store',
    'x-content-type-options':'nosniff','x-request-id':randomUUID(), ...headers
  }});
}
export function failure(status, code, message, headers = {}) {
  return json({error:{code,message}},status,headers);
}
export function readApi(request) {
  const {pathname} = new URL(request.url);
  if (request.method !== 'GET') return failure(405,'method_not_allowed','This resource supports GET.',{allow:'GET'});
  switch (pathname) {
    case apiBase+'/capabilities': return json(makeCapabilities('node-reference'));
    case apiBase+'/openapi.json': return json(openapi());
    case apiBase+'/health': return json({status:'ok',mode:policy.mode,policyVersion:policy.version});
    case apiBase+'/policy': return json(policy);
    case apiBase+'/collections': return json({items:[
      {id:'genesis',status:'planned',...policy.genesis},
      {id:'seasons',status:'planned',...policy.season}
    ],nextCursor:null,snapshotId:policy.version});
    default: return failure(404,'not_found','Unknown API resource.');
  }
}

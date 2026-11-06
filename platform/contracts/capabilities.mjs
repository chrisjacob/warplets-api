// Pure runtime inventory. These are local HTTP capabilities, not release approvals.
const route=(method,path)=>({method,path:'/api/v1'+path});
const feature=(id,routes)=>({id,status:'local-validation',routes:routes.map(([method,path])=>route(method,path))});
const shared=[
 ['discovery',[['GET','/capabilities'],['GET','/policy'],['GET','/collections'],['GET','/health'],['GET','/openapi.json']]],
 ['genesis-refresh-fixture-review',[['GET','/nfts/refreshes/{id}'],['POST','/nfts/refreshes/{id}/prepare'],['POST','/nfts/refreshes/{id}/execute'],['POST','/nfts/refreshes/{id}/receipt']]],
 ['transaction-receipt-preview',[['GET','/transactions/{id}']]],
 ['wallet-message-auth',[['POST','/auth/challenges'],['POST','/auth/verify'],['POST','/auth/logout'],['GET','/me'],['GET','/me/wallets']]],
 ['market-read',[['GET','/markets'],['GET','/markets/{id}'],['GET','/launch/fee-schedule']]],
 ['quote-preview',[['GET','/markets/{id}/quote-status'],['POST','/quotes']]],
 ['vault-preview',[['GET','/vault'],['GET','/nfts/{id}/vault']]],
 ['stake-preview',[['GET','/farms/{id}'],['GET','/stake/positions']]],
 ['earn-board-preview',[['GET','/earn/epochs/{epoch}/leaderboard'],['GET','/earn/claims']]],
 ['earn-admission',[['GET','/earn/capacity'],['POST','/earn/submissions'],['GET','/earn/me']]],
 ['earn-actions',[['GET','/earn/actions'],['POST','/earn/actions/{actionId}/completions']]],
 ['collection-inventory-read',[['GET','/collect/inventories'],['GET','/collect/inventories/{id}']]],
 ['collection-fixture-requests',[['POST','/collect/inventories/{id}/stages/{stage}/reservations']]],
 ['collection-fairness-read',[['GET','/collect/me/operations/{id}/fairness']]],
 ['collection-asset-operation-read',[['GET','/collect/assets/{id}'],['GET','/collect/me/assets'],['GET','/collect/me/operations'],['GET','/collect/me/operations/{id}']]],
 ['collection-progression-preview',[['POST','/collect/inventories/{id}/progression'],['POST','/collect/inventories/{id}/progression/quote']]],
 ['genesis-advisory-vote',[['GET','/genesis/ballots'],['GET','/genesis/ballots/{id}'],['POST','/genesis/ballots/{id}/votes']]],
 ['local-inbox',[['GET','/notifications/capabilities'],['GET','/notifications/subscriptions'],['POST','/notifications/subscriptions'],['GET','/notifications/inbox']]],
];
const nodeOnly=[
 ['launch-plan-preview',[['GET','/launch-plans'],['POST','/launch-plans/preview']]],
 ['earn-archive',[['GET','/earn/epochs/{epoch}/manifest'],['GET','/earn/claims/proof']]],
 ['local-operation-status',[['GET','/operations/status']]],
];

export function makeCapabilities(runtime) {
 if(!['node-reference','workerd-local'].includes(runtime))throw new TypeError('Unknown local runtime.');
 const entries=[...shared,...(runtime==='node-reference'?nodeOnly:[['verified-manifest-read',[['GET','/manifests/{digest}']]]])];
 return {version:1,mode:'local-validation',runtime,apiBase:'/api/v1',openapi:'/api/v1/openapi.json',
   featureScope:'listed-routes-only',features:entries.map(([id,routes])=>feature(id,routes)),
   production:{financialExecution:false,serverSigning:false,broadcast:false,deposits:false,claimExecution:false},
   walletAuthentication:'message-only',externalNotifications:false};
}

const object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
export const capabilitiesSchema=object({version:{const:1},mode:{const:'local-validation'},runtime:{enum:['node-reference','workerd-local']},
 apiBase:{const:'/api/v1'},openapi:{const:'/api/v1/openapi.json'},featureScope:{const:'listed-routes-only'},
 features:{type:'array',items:object({id:{type:'string'},status:{const:'local-validation'},routes:{type:'array',items:object({method:{enum:['GET','POST']},path:{type:'string',pattern:'^/api/v1/'}})}})},
 production:object({financialExecution:{const:false},serverSigning:{const:false},broadcast:{const:false},deposits:{const:false},claimExecution:{const:false}}),
 walletAuthentication:{const:'message-only'},externalNotifications:{const:false}});

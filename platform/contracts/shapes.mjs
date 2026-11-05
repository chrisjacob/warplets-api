// Wire types shared by the OpenAPI document and generated client declarations.
const str={type:'string'},integer={type:'integer'},bool={type:'boolean'},units={type:'string',pattern:'^(0|[1-9][0-9]*)$'};
const iso={type:'string',format:'date-time'};
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required});
const array=items=>({type:'array',items});
const ref=name=>({$ref:'#/components/schemas/'+name});
const nullable=item=>({anyOf:[item,{type:'null'}]});
const page=item=>object({items:array(item),nextCursor:nullable(str),snapshotId:str,meta:ref('Meta')});
const enriched=schema=>object({data:schema,meta:ref('Meta')});
export const shapes={
 Meta:object({requestId:str,policyVersion:str,asOf:iso,sourceSlot:nullable(integer)}),
 Error:object({error:object({code:str,message:str,retryable:bool,requestId:str,retryAfter:integer},['code','message','retryable','requestId'])}),
 Market:object({id:str,symbol:str,ogSymbol:str,activatedAt:iso,attMint:str,ogMint:str,poolAddress:str,source:{const:'local-fixture'},
 chain:{const:'solana'},status:{enum:['scheduled','active','campaign-ended']},feeBps:nullable(integer),executable:{const:false}}),
 FeePoint:object({elapsedSeconds:integer,feeBps:integer}),
 VaultAllocation:object({marketId:str,allocated:units,vested:units,claimed:units,claimable:units,manifestDigest:str}),
 Profile:object({wallet:str,chain:{const:'solana'}}),
 Challenge:object({nonce:str,message:str,expiresAt:iso}),
 Stage:object({id:str,type:str,status:str,opensAt:iso,closesAt:iso,publishedAt:iso,priceLamports:units,costLamports:units,
   allocation:integer,available:integer,walletLimit:integer,eligible:nullable(bool),walletReservations:nullable(integer),termsDigest:str,openingHold:nullable(str)}),
 Inventory:object({id:str,kind:{enum:['genesis','season']},tranche:nullable(integer),seasonStart:nullable(iso),capacity:integer,
   counts:{type:'object',additionalProperties:integer},initialLevelQuotas:array(integer),stages:array(ref('Stage')),source:str,executable:bool}),
 CollectionAsset:object({id:str,inventoryId:str,owner:str,revealStatus:{enum:['unrevealed','revealed']},level:integer,
   traits:object({model:str,backdrop:str,symbol:str}),version:integer,rerolls:integer,nextRerollAt:nullable(iso),expiresAt:nullable(iso),
   operationPending:bool,source:str,executable:bool},['id','inventoryId','owner','revealStatus','source','executable']),
 CollectionOperation:object({id:str,kind:{enum:['mint','upgrade','visual']},inventoryId:str,owner:str,stageId:nullable(str),
   targetId:nullable(str),materialId:nullable(str),status:{enum:['awaiting-evidence','fulfilled']},createdAt:iso,
   priceLamports:nullable(units),costLamports:nullable(units),feeLamports:nullable(units),assetId:nullable(str),source:str,executable:bool}),
 ProgressionQuote:object({kind:{enum:['upgrade','visual']},inventoryId:str,targetId:str,materialId:nullable(str),feeLamports:units,
   nextTargetLevel:integer,nextTargetExpiry:iso,materialProbabilities:array(object({level:integer,count:integer,total:integer})),
   level:integer,cooldownMs:integer,fields:array(str),source:str,executable:bool},
   ['kind','inventoryId','targetId','materialId','feeLamports','source','executable']),
};
export const success={
 listMarkets:page(ref('Market')),getMarket:enriched(ref('Market')),
 getFeeSchedule:enriched(object({points:array(ref('FeePoint')),unit:str,clock:str})),
 getProfile:enriched(ref('Profile')),createWalletChallenge:enriched(ref('Challenge')),
 verifyWalletSignature:enriched(object({wallet:str})),revokeSession:enriched(object({revoked:bool})),
 getMyVault:page(object({id:str,detail:str})),
 getNftVault:{allOf:[page(ref('VaultAllocation')),object({assetId:str,slot:{type:'object'},asOf:iso})]},
 getHealth:enriched(object({status:str,mode:str,policyVersion:str})),
 getGenesisBallot:enriched(object({id:str,status:str,eligibleWallets:integer,votesCast:integer},['id','status','eligibleWallets','votesCast'])),
 castGenesisVote:enriched(object({choice:{enum:['ASAP','7','14','30']},replayed:bool}))
};
Object.assign(success,{
 listLocalInventories:page(ref('Inventory')),readLocalInventory:enriched(ref('Inventory')),
 readLocalAsset:enriched(ref('CollectionAsset')),listMyCollectionAssets:page(ref('CollectionAsset')),
 listMyCollectionOperations:page(ref('CollectionOperation')),readMyCollectionOperation:enriched(ref('CollectionOperation')),
 reserveLocalMint:enriched(object({operation:ref('CollectionOperation'),replayed:bool})),
 reserveLocalProgression:enriched(object({operation:ref('CollectionOperation'),replayed:bool})),quoteLocalProgression:enriched(ref('ProgressionQuote')),
 getStakePositions:page(object({marketId:str,principalUnits:units,earnedGrossUnits:units,claimableGrossUnits:units,
   harvestedGrossUnits:units,treasuryFeeBps:integer,asOf:iso})),getWallets:page(object({address:str,chain:str})),
});
const cursorMethods=new Set(['getMyVault','getNftVault','getStakePositions','listLocalInventories','listMyCollectionAssets','listMyCollectionOperations']);
const progression=object({kind:{enum:['visual','upgrade']},targetId:str,expectedTargetVersion:integer,
  materialId:str,expectedMaterialVersion:integer},['kind','targetId','expectedTargetVersion']);
const bodies={reserveLocalMint:{type:'object',additionalProperties:false},reserveLocalProgression:progression,quoteLocalProgression:progression};
export function describeResponses(paths) {
 // Build a new tree so producing docs never mutates shared route definitions.
 const result=structuredClone(paths);
 for(const path of Object.values(result))for(const [method,operation] of Object.entries(path)){
  if(!['get','post','delete','patch','put'].includes(method))continue;
  if(cursorMethods.has(operation.operationId))operation.parameters=[...(operation.parameters??[]),{in:'query',name:'cursor',schema:str}];
  if(bodies[operation.operationId])operation.requestBody={required:true,content:{'application/json':{schema:bodies[operation.operationId]}}};
  for(const [status,response] of Object.entries(operation.responses??{})){
   const schema=Number(status)>=400?ref('Error'):success[operation.operationId]??{type:'object'};
   response.content={...response.content,'application/vnd.10x.v1+json':{schema}};
  }
 }
 return result;
}

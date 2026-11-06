import {createNodeMintServices} from './node-mint.mjs';
import {handleMintReservation} from './mint-http.mjs';
import {createInventoryReadRepository} from './inventory-read-model.mjs';
import {handleInventoryReads} from './inventory-read-http.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createCollectionReadRepository} from './read-model.mjs';
import {handleCollectionReads} from './read-http.mjs';
import {createNodeProgressionServices} from './node-progression.mjs';
import {handleProgression} from './progression-http.mjs';
import { CollectionPolicyError } from '../domain/collections/policy.mjs';
import { currentSession, consumeQuota } from '../server/auth.mjs';
import { json, failure } from '../server/api.mjs';
import { CollectError, id, need, reserveMint } from './store.mjs';

const base='/api/v1/collect';
const patterns={
  inventory:new RegExp('^'+base+'/inventories/([A-Za-z0-9._:-]{1,128})$'),
  asset:new RegExp('^'+base+'/assets/([A-Za-z0-9._:-]{1,128})$'),
  reserve:new RegExp('^'+base+'/inventories/([A-Za-z0-9._:-]{1,128})/stages/([A-Za-z0-9._:-]{1,128})/reservations$'),
  progress:new RegExp('^'+base+'/inventories/([A-Za-z0-9._:-]{1,128})/progression(/quote)?$'),
  receipt:new RegExp('^'+base+'/me/operations/([A-Za-z0-9._:-]{1,128})$'),
};
async function bodyOf(request) {
  need(request.headers.get('content-type')?.split(';')[0]==='application/json',
    'unsupported_media_type','Use application/json.',415);
  const text=await request.text();
  need(Buffer.byteLength(text)<=4096,'payload_too_large','Collection requests are limited to 4 KiB.',413);
  let input;
  try{input=JSON.parse(text);}catch{throw new CollectError(400,'invalid_input','Invalid JSON.');}
  need(input && typeof input==='object' && !Array.isArray(input),'invalid_input','Expected an object.');
  return input;
}
export async function handleCollect(db,request,peer,now) {
  const url=new URL(request.url),path=url.pathname;
  if(path!==base && !path.startsWith(base+'/')) return null;
  if(patterns.inventory.test(path)||path===base+'/inventories')return handleInventoryReads(request,{reads:createInventoryReadRepository(createNodeAtomicDriver(db),{normalizedAdmissionAvailable:true}),clock:{nowMs:()=>now},
    authenticate:async req=>{const session=currentSession(db,req,now);return session?{kind:'wallet',wallet:session.wallet}:null;},
    consumeQuota:async(bucket,limit)=>consumeQuota(db,bucket,now,limit)});
  if(patterns.progress.test(path))return handleProgression(request,{...createNodeProgressionServices(db,{clock:{nowMs:()=>now}}),
    authenticate:async req=>{const session=currentSession(db,req,now);return session?{kind:'wallet',wallet:session.wallet}:null;},
    consumeQuota:async(bucket,limit)=>consumeQuota(db,bucket,now,limit)});
  if(patterns.asset.test(path)||patterns.receipt.test(path)||path===base+'/me/assets'||path===base+'/me/operations')return handleCollectionReads(request,{reads:createCollectionReadRepository(createNodeAtomicDriver(db)),clock:{nowMs:()=>now},
    authenticate:async req=>{const session=currentSession(db,req,now);return session?{kind:'wallet',wallet:session.wallet}:null;},
    consumeQuota:async(bucket,limit)=>consumeQuota(db,bucket,now,limit)});
  const normalizedMint=patterns.reserve.exec(path);
  if(normalizedMint&&db.prepare('SELECT 1 FROM app_collection_authorities WHERE inventory_id=?').get(normalizedMint[1]))return handleMintReservation(request,{...createNodeMintServices(db,{clock:{nowMs:()=>now}}),
    authenticate:async req=>{const session=currentSession(db,req,now);return session?{kind:'wallet',wallet:session.wallet}:null;},
    consumeQuota:async(bucket,limit)=>consumeQuota(db,bucket,now,limit)});
  try {
    const mint=patterns.reserve.exec(path);
    if(!mint)return failure(404,'not_found','Unknown collection resource.');
    if(request.method!=='POST')return failure(405,'method_not_allowed','Unsupported method.',{allow:'POST'});
    const session=currentSession(db,request,now);
    if(!session)return failure(401,'authentication_required','Sign in to access this resource.');
    need(!url.search,'invalid_query','Operation requests do not accept query parameters.');
    need(request.headers.get('origin')===url.origin,'invalid_origin','Use the configured local origin.',403);
    const rate=consumeQuota(db,'collect-write:'+session.wallet,now,15);
    if(rate) return rate;
    const requestKey=id(request.headers.get('idempotency-key'));
    const input=await bodyOf(request);
    let result;
    if(mint) {
      need(Object.keys(input).every(key=>key==='expectedTermsDigest'),'unexpected_fields','Supply only the reviewed terms digest.');
      result=reserveMint(db,{inventoryId:mint[1],stageId:mint[2],wallet:session.wallet,requestKey,expectedTermsDigest:input.expectedTermsDigest,now});
    }
    return json(result,result.replayed?200:201);
  } catch(error) {
    if(error instanceof CollectError) return failure(error.status,error.code,error.message);
    if(error instanceof CollectionPolicyError) {
      const status=error.code.startsWith('invalid_')||error.code==='unexpected_material'?400
        :['wrong_owner','wallet_ineligible'].includes(error.code)?403:409;
      return failure(status,error.code,error.code.replaceAll('_',' ')+'.');
    }
    throw error;
  }
}
const operation=(id,summary)=>({operationId:id,summary,responses:{200:{description:'Local collection response'}}});
const parameter=name=>({name,in:'path',required:true,schema:{type:'string'}});
const read=(id,summary,names=[])=>({parameters:names.map(parameter),get:operation(id,summary)});
const write=(id,summary,names)=>({parameters:names.map(parameter),post:{...operation(id,summary),
  parameters:[{name:'Idempotency-Key',in:'header',required:true,schema:{type:'string'}}],
  responses:{200:{description:'Original operation on retry'},201:{description:'Pending local evidence'},409:{description:'State conflict'}}}});
export const collectPaths={
  '/collect/inventories':read('listLocalInventories','See published local collections and stages.'),
  '/collect/inventories/{id}':read('readLocalInventory','See inventory and published stages.',['id']),
  '/collect/assets/{id}':read('readLocalAsset','See local ownership and publicly revealed metadata.',['id']),
  '/collect/me/assets':read('listMyCollectionAssets','See the signed-in wallet’s assets.'),
  '/collect/me/operations':read('listMyCollectionOperations','Recover pending or fulfilled local operations.'),
  '/collect/me/operations/{id}':read('readMyCollectionOperation','Inspect one of the signed-in wallet’s operations.',['id']),
  '/collect/inventories/{id}/stages/{stage}/reservations':write('reserveLocalMint','Reserve one local fixture slot.',['id','stage']),
  '/collect/inventories/{id}/progression':write('reserveLocalProgression','Reserve local Season assets for a progression fixture.',['id']),
  '/collect/inventories/{id}/progression/quote':{parameters:[parameter('id')],post:{...operation('quoteLocalProgression','Store immutable local cost and outcome terms before reviewing progression.'),parameters:[{name:'Idempotency-Key',in:'header',required:true,schema:{type:'string'}}]}},
};

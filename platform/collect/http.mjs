import { CollectionPolicyError } from '../domain/collections/policy.mjs';
import { currentSession, consumeQuota } from '../server/auth.mjs';
import { json, failure } from '../server/api.mjs';
import { CollectError, id, listInventories, listOwnedAssets, listOwnOperations, need, quoteProgression,
  readCollectionAsset, readInventory, readOwnOperation, reserveMint, reserveProgression } from './store.mjs';

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
function validCursor(url) {
  need([...url.searchParams.keys()].every(k=>k==='cursor') && url.searchParams.getAll('cursor').length<=1,
    'invalid_cursor','Only a single cursor is accepted.');
  const cursor=url.searchParams.get('cursor')??'';
  if(cursor) id(cursor);
  return cursor;
}
export async function handleCollect(db,request,peer,now) {
  const url=new URL(request.url),path=url.pathname;
  if(path!==base && !path.startsWith(base+'/')) return null;
  try {
    const inventory=patterns.inventory.exec(path),asset=patterns.asset.exec(path);
    const mint=patterns.reserve.exec(path),progress=patterns.progress.exec(path),receipt=patterns.receipt.exec(path);
    const owned=path===base+'/me/assets',operations=path===base+'/me/operations';
    const list=path===base+'/inventories';
    if(!list&&!inventory&&!asset&&!owned&&!operations&&!mint&&!progress&&!receipt) {
      return failure(404,'not_found','Unknown collection resource.');
    }
    const write=Boolean(mint||progress);
    if(request.method!==(write?'POST':'GET')) return failure(405,'method_not_allowed','Unsupported method.',{allow:write?'POST':'GET'});
    const session=currentSession(db,request,now);
    if((owned||operations||receipt||write)&&!session) return failure(401,'authentication_required','Sign in to access this resource.');
    if(!write) {
      const cursor=validCursor(url);
      if(inventory||asset||receipt) need(!cursor,'invalid_cursor','This resource does not accept a cursor.');
      if(list) return json(listInventories(db,{now,after:cursor,wallet:session?.wallet??null}));
      if(inventory) return json(readInventory(db,inventory[1],now,session?.wallet??null));
      if(asset) return json(readCollectionAsset(db,asset[1]));
      const rate=consumeQuota(db,'collect-owner:'+session.wallet,now,60);
      if(rate) return rate;
      if(receipt) return json(readOwnOperation(db,session.wallet,receipt[1]));
      return json(owned?listOwnedAssets(db,session.wallet,cursor):listOwnOperations(db,session.wallet,cursor));
    }
    need(!url.search,'invalid_query','Operation requests do not accept query parameters.');
    need(request.headers.get('origin')===url.origin,'invalid_origin','Use the configured local origin.',403);
    const rate=consumeQuota(db,'collect-write:'+session.wallet,now,15);
    if(rate) return rate;
    const requestKey=progress?.[2]?null:id(request.headers.get('idempotency-key'));
    const input=await bodyOf(request);
    let result;
    if(mint) {
      need(Object.keys(input).length===0,'unexpected_fields','State, price and account come from the server.');
      result=reserveMint(db,{inventoryId:mint[1],stageId:mint[2],wallet:session.wallet,requestKey,now});
    } else {
      need(Object.keys(input).every(k=>['kind','targetId','materialId','expectedTargetVersion','expectedMaterialVersion'].includes(k)),
        'unexpected_fields','Unexpected progression request field.');
      const args={inventoryId:progress[1],requestKey,request:input,wallet:session.wallet,now};
      if(progress[2]) return json(quoteProgression(db,args));
      result=reserveProgression(db,args);
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
  '/collect/inventories/{id}/progression/quote':{parameters:[parameter('id')],post:operation('quoteLocalProgression','Inspect local cost and changes before preparing a progression.')},
};

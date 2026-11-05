import { consumeQuota } from '../server/auth.mjs';
import { failure,json } from '../server/api.mjs';
import { boundedJson,BodyInputError } from '../server/body.mjs';
import { QuoteError,requireQuote } from './math.mjs';
import { quoteExactInput,quoteAvailability } from './evidence.mjs';

export async function handleQuotes(db,request,peer,now){
  const {pathname,search,origin}=new URL(request.url);
  const status=/^\/api\/v1\/markets\/([a-z0-9][a-z0-9-]{0,63})\/quote-status$/.exec(pathname);
  if(!status && pathname!=='/api/v1/quotes')return null;
  const method=status?'GET':'POST';
  if(request.method!==method)return failure(405,'method_not_allowed','Use '+method+'.',{allow:method});
  try{
    requireQuote(!search,'invalid_query','Quote endpoints do not accept query parameters.',400);
    const quota=consumeQuota(db,'quote:'+peer,now,status?60:20);
    if(quota)return quota;
    if(status)return json(quoteAvailability(db,status[1],now));
    requireQuote(request.headers.get('origin')===origin,'invalid_origin','Use the local origin.',403);
    requireQuote(request.headers.get('content-type')?.split(';')[0]==='application/json','unsupported_media_type','Use application/json.',415);
    const input=await boundedJson(request,2048);
    requireQuote(input && typeof input==='object' && !Array.isArray(input)
      && Object.keys(input).every(k=>['marketId','direction','inputUnits','slippageBps'].includes(k))
      && typeof input.marketId==='string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(input.marketId),
      'invalid_request','Provide marketId, direction, inputUnits and slippageBps.',400);
    return json(quoteExactInput(db,input,now));
  }catch(error){
    if(error instanceof QuoteError || error instanceof BodyInputError)return failure(error.status,error.code,error.message);
    throw error;
  }
}
const decimal={type:'string',pattern:'^(0|[1-9][0-9]*)$'};
const text={type:'string'},timestamp={type:'string',format:'date-time'},integer={type:'integer',minimum:0};
const quoteFields={
  id:text,version:{const:1},marketId:text,direction:{enum:['buy-att','sell-att']},
  inputMint:text,outputMint:text,inputDecimals:integer,outputDecimals:integer,
  inputUnits:decimal,expectedOutputUnits:decimal,minimumOutputUnits:decimal,grossOutputUnits:decimal,
  inputFeeUnits:decimal,outputFeeUnits:decimal,feeBps:integer,priceImpactBps:decimal,nextSqrtPriceX64:decimal,
  slippageBps:integer,quotedAt:timestamp,expiresAt:timestamp,contextSlot:integer,observedAt:timestamp,sourceHash:text,
  spotFdvUsdMicros:decimal,effectiveBuyFdvUsdMicros:{anyOf:[decimal,{type:'null'}]},
  fees:{type:'object',required:['asset','side','networkLamports','accountRentLamports'],
    properties:{asset:text,side:{enum:['input','output']},networkLamports:{type:'null'},accountRentLamports:{type:'null'}}},
  source:{const:'local-fixture'},route:{const:'meteora-damm-v2'},executable:{const:false},
};
const schemaResponse=(description,properties,required=Object.keys(properties))=>({
  description,content:{'application/json':{schema:{type:'object',properties,required}}},
});
export const quotePaths={
  '/markets/{id}/quote-status':{parameters:[{name:'id',in:'path',required:true,schema:{type:'string'}}],
    get:{operationId:'getQuoteAvailability',responses:{200:schemaResponse('Whether fresh verified local evidence is available.',{
      available:{type:'boolean'},expiresAt:timestamp,reason:text,attDecimals:integer,ogDecimals:integer,
      source:{const:'local-fixture'},executable:{const:false}},['available','source','executable'])}}},
  '/quotes':{post:{operationId:'previewSwapQuote',requestBody:{required:true,content:{'application/json':{schema:{
    type:'object',additionalProperties:false,required:['marketId','direction','inputUnits','slippageBps'],
    properties:{marketId:{type:'string'},direction:{enum:['buy-att','sell-att']},inputUnits:decimal,slippageBps:{type:'integer',minimum:0,maximum:500}}}}}},
    responses:{200:schemaResponse('Exact-in local price, included trading fee, impact, min output and evidence-bound expiry.',quoteFields),
      422:{description:'Pool range, dust or risk limit prevents a quote.'},503:{description:'Source missing, held or expired.'}}}},
};

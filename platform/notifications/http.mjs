import { consumeQuota, currentSession } from '../server/auth.mjs';
import { boundedJson, BodyInputError } from '../server/body.mjs';
import { failure, json } from '../server/api.mjs';
import { EarnError } from '../earn/checks.mjs';
import { inbox, noticeCapabilities, preferences, setConsent, TERMS } from './notices.mjs';

const base='/api/v1/notifications';
const response=description=>({description,content:{'application/json':{schema:{type:'object'}}}});
const consentFields={channel:{const:'local-inbox'},enabled:{type:'boolean'},topics:{type:'array',uniqueItems:true,
  items:{type:'string',enum:['launch','voting','rewards']}},terms:{const:TERMS},expectedRevision:{type:'integer',minimum:0}};
export const notificationPaths={
  '/notifications/capabilities':{get:{operationId:'getNoticeCapabilities',summary:'Discover supported local notice topics and explicit consent terms.',
    responses:{200:response('Local delivery capabilities')}}},
  '/notifications/subscriptions':{get:{operationId:'getMyNoticePreferences',summary:'Read your local inbox consent.',
    responses:{200:response('Wallet preferences'),401:response('Wallet session required')}},
    post:{operationId:'setMyNoticePreferences',summary:'Opt into local topic notices or revoke consent.',
      parameters:[{in:'header',name:'Idempotency-Key',required:true,schema:{type:'string',maxLength:128}}],
      requestBody:{required:true,content:{'application/json':{schema:{type:'object',additionalProperties:false,
        required:Object.keys(consentFields),properties:consentFields}}}},
      responses:{200:response('Accepted consent revision or replay'),401:response('Wallet session required'),409:response('Consent revision conflict')}}},
  '/notifications/inbox':{get:{operationId:'getMyLocalNotices',summary:'Read your delivered, unexpired local notices.',
    parameters:[{in:'query',name:'cursor',schema:{type:'string'}}],responses:{200:response('Private inbox'),401:response('Wallet session required')}}}
};
export async function handleNotifications(db,request,peer,now) {
  const u=new URL(request.url),which=u.pathname.slice(base.length);
  if(!u.pathname.startsWith(base+'/')||!['/capabilities','/subscriptions','/inbox'].includes(which))return null;
  const methods=which==='/subscriptions'?['GET','POST']:['GET'];
  if(!methods.includes(request.method))return failure(405,'method_not_allowed','Unsupported method.',{allow:methods.join(', ')});
  if(which==='/capabilities')return json(noticeCapabilities);
  if(request.method==='POST'&&request.headers.get('origin')!==u.origin)return failure(403,'invalid_origin','Use the local origin.');
  const session=currentSession(db,request,now);if(!session)return failure(401,'authentication_required','Connect your wallet.');
  const quota=consumeQuota(db,'notice:'+request.method+':'+session.wallet,now,request.method==='POST'?10:60);if(quota)return quota;
  try {
    if(which==='/inbox') {
      const cursor=u.searchParams.get('cursor');
      const match=cursor==null?null:/^(\d{1,15})\.([a-f0-9]{64})$/.exec(cursor);
      if(cursor!=null&&!match)return failure(400,'invalid_cursor','Invalid inbox cursor.');
      return json(inbox(db,{wallet:session.wallet,now,...(match?{beforeMs:Number(match[1]),beforeId:match[2]}:{})}));
    }
    if(request.method==='GET')return json(preferences(db,session.wallet));
    if(request.headers.get('content-type')?.split(';')[0]!=='application/json')return failure(415,'unsupported_media_type','Use application/json.');
    const b=await boundedJson(request,2048);
    if(!b||Array.isArray(b)||typeof b!=='object'||Object.keys(b).length!==Object.keys(consentFields).length||
        Object.keys(b).some(k=>!Object.hasOwn(consentFields,k)))return failure(400,'invalid_input','Supply only channel, enabled, topics, terms and expectedRevision.');
    const key=request.headers.get('idempotency-key');
    if(!key||!/^[A-Za-z0-9._:-]{1,128}$/.test(key))return failure(400,'invalid_input','Use a scoped Idempotency-Key.');
    return json(setConsent(db,{wallet:session.wallet,channel:b.channel,enabled:b.enabled,selectedTopics:b.topics,
      terms:b.terms,expectedRevision:b.expectedRevision,requestKey:key,now}));
  } catch(error) {
    if(error instanceof EarnError||error instanceof BodyInputError)return failure(error.status,error.code,error.message);
    throw error;
  }
}

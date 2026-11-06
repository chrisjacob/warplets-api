import { consumeQuota, currentSession } from '../server/auth.mjs';
import {handleNotificationConsent} from './consent-http.mjs';
import {createNotificationConsentService} from './consent.mjs';
import {createNotificationConsentRepository} from '../storage/notification-consent.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {randomUUID} from 'node:crypto';
import { failure, json } from '../server/api.mjs';
import { EarnError } from '../earn/checks.mjs';
import { inbox, TERMS } from './notices.mjs';

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
  if(which!=='/inbox'){
    const ports={crypto:createNodeCrypto(),ids:{next:randomUUID},clock:{nowMs:()=>now}},service=createNotificationConsentService({...ports,repository:createNotificationConsentRepository(createNodeAtomicDriver(db),ports)});
    return handleNotificationConsent(request,{service,authenticate:async req=>{const session=currentSession(db,req,now);return session?{kind:'wallet',wallet:session.wallet}:null;},consumeQuota:async(bucket,limit)=>consumeQuota(db,bucket,now,limit)});
  }
  if(request.method!=='GET')return failure(405,'method_not_allowed','Unsupported method.',{allow:'GET'});
  const session=currentSession(db,request,now);if(!session)return failure(401,'authentication_required','Connect your wallet.');
  const quota=consumeQuota(db,'notice:'+request.method+':'+session.wallet,now,request.method==='POST'?10:60);if(quota)return quota;
  try {
    if(which==='/inbox') {
      const cursor=u.searchParams.get('cursor');
      const match=cursor==null?null:/^(\d{1,15})\.([a-f0-9]{64})$/.exec(cursor);
      if(cursor!=null&&!match)return failure(400,'invalid_cursor','Invalid inbox cursor.');
      return json(inbox(db,{wallet:session.wallet,now,...(match?{beforeMs:Number(match[1]),beforeId:match[2]}:{})}));
    }
  } catch(error) {
    if(error instanceof EarnError)return failure(error.status,error.code,error.message);
    throw error;
  }
}

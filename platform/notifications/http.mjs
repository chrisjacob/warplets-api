import { consumeQuota, currentSession } from '../server/auth.mjs';
import {handleNotificationConsent} from './consent-http.mjs';
import {createNotificationConsentService} from './consent.mjs';
import {createNotificationConsentRepository} from '../storage/notification-consent.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {randomUUID} from 'node:crypto';
import {NOTICE_TERMS as TERMS} from './consent.mjs';
import {createNotificationDeliveryRepository} from '../storage/notification-delivery.mjs';

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
  const ports={crypto:createNodeCrypto(),ids:{next:randomUUID},clock:{nowMs:()=>now}},driver=createNodeAtomicDriver(db);
  const service=createNotificationConsentService({...ports,repository:createNotificationConsentRepository(driver,ports)}),reads=createNotificationDeliveryRepository(driver,ports);
  return handleNotificationConsent(request,{service,readInbox:reads.readInbox,authenticate:async req=>{const session=currentSession(db,req,now);return session?{kind:'wallet',wallet:session.wallet}:null;},consumeQuota:async(bucket,limit)=>consumeQuota(db,bucket,now,limit)});
}

import {currentSession} from '../server/auth.mjs';
import {json,failure} from '../server/api.mjs';
import {readIntent} from './intents.mjs';
export function handleTransactions(db,request,now){
 const path=new URL(request.url).pathname,base='/api/v1/transactions';
 if(!path.startsWith(base+'/'))return null;
 const session=currentSession(db,request,now);if(!session)return failure(401,'authentication_required','Connect your wallet.');
 if(path===base+'/prepare'||path.endsWith('/confirm')){
  if(request.method!=='POST')return failure(405,'method_not_allowed','Use POST.',{allow:'POST'});
  return failure(503,'financial_adapter_disabled','Financial preparation and broadcast are disabled in the local release.');
 }
 if(request.method!=='GET')return failure(405,'method_not_allowed','Use GET.',{allow:'GET'});
 const intent=readIntent(db,path.slice(base.length+1),session.wallet);
 return intent?json(intent):failure(404,'not_found','Unknown transaction.');
}
export const txPaths={'/transactions/{id}':{parameters:[{in:'path',name:'id',required:true,schema:{type:'string'}}],
 get:{operationId:'getTransaction',responses:{200:{description:'Owner-scoped rehearsal state and current attempt'},401:{description:'Session required'},404:{description:'Unknown transaction'}}}}};

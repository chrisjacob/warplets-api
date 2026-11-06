import {readFileSync,statSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createNotificationDeliveryRepository} from '../storage/notification-delivery.mjs';
import {buildEnqueueNoticeCommand,noticeWorkerPrincipal} from './delivery-plan.mjs';
const fields={enqueue:[['operatorId','requestKey','input'],[]],lease:[['operatorId'],['limit']],finish:[['operatorId','id','lease'],['outcome']],reconcile:[['operatorId','id'],[]],purge:[['operatorId'],['limit']],drain:[['operatorId'],['limit']]};
/** Local, explicit worker invocation. No scheduler, self-grant or external send. */
export async function runNoticeCli(argv){
 const [database,verb,file]=argv;
 if(argv.length!==3||!Object.hasOwn(fields,verb))throw Error('Use LOCAL_DB enqueue|lease|finish|reconcile|purge|drain FIXTURE.json');
 const info=statSync(file);if(!info.isFile()||info.size>16384)throw Error('Use a bounded16KiB local notice fixture.');
 const stat=readFileSync(file);if(stat.byteLength>16384)throw Error('Notice fixture exceeds16KiB.');const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(stat)),[required,optional]=fields[verb];
 if(!input||typeof input!=='object'||Array.isArray(input)||required.some(k=>!Object.hasOwn(input,k))||Object.keys(input).some(k=>![...required,...optional].includes(k)))throw Error('Supply exact private notice worker fields.');
 const principal=noticeWorkerPrincipal({kind:'operator',id:input.operatorId}),db=openDatabase(database),ports={crypto:createNodeCrypto(),clock:{nowMs:Date.now},ids:{next:randomUUID}};
 try{
  const repository=createNotificationDeliveryRepository(createNodeAtomicDriver(db),ports);let result;
  if(verb==='enqueue')result=await repository.enqueueNotice(await buildEnqueueNoticeCommand({principal,requestKey:input.requestKey,input:input.input,nowMs:Date.now()},ports.crypto));
  else if(verb==='lease'||verb==='drain'){
   result=await repository.leaseDue(principal,{...(Object.hasOwn(input,'limit')?{limit:input.limit}:{})});
   if(verb==='drain'&&Array.isArray(result)){const finished=[];for(const lease of result)finished.push(await repository.finishLease(principal,lease));result=finished;}
  }else if(verb==='finish')result=await repository.finishLease(principal,{id:input.id,lease:input.lease,...(Object.hasOwn(input,'outcome')?{outcome:input.outcome}:{})});
  else if(verb==='reconcile')result=await repository.reconcileUnknown(principal,{id:input.id});
  else result=await repository.purgeExpired(principal,{...(Object.hasOwn(input,'limit')?{limit:input.limit}:{})});
  return {mode:'local-inbox',externalTransport:false,financialExecution:false,result};
 }finally{db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log(JSON.stringify(await runNoticeCli(process.argv.slice(2)),null,2));}
 catch{console.error('Local notice command failed. Check the fixture fields, worker scope and retained evidence.');process.exitCode=1;}
}

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { openDatabase } from '../storage/database.mjs';
import { enqueueNotice, leaseDue, finishLease, reconcileUnknown, purgeExpired } from './notices.mjs';

export function runNoticeCli(argv) {
  const [database,verb,file]=argv;
  const actions={enqueue:enqueueNotice,lease:leaseDue,finish:finishLease,reconcile:reconcileUnknown,purge:purgeExpired,
    drain:(db,{now,limit})=>leaseDue(db,{now,limit}).map(l=>finishLease(db,{...l,now}))};
  if(argv.length!==3||!Object.hasOwn(actions,verb))throw Error('Use LOCAL_DB enqueue|lease|finish|reconcile|purge|drain FIXTURE.json');
  const input=JSON.parse(readFileSync(file,'utf8'));
  const db=openDatabase(database);
  try{return actions[verb](db,input);}finally{db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{console.log(JSON.stringify(runNoticeCli(process.argv.slice(2)),null,2));}
  catch(error){console.error(error.message);process.exitCode=1;}
}

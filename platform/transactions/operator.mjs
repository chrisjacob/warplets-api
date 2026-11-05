import {mkdirSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {openDatabase} from '../storage/database.mjs';
import {createIntent,prepareAttempt,expireAttempt,observeSignedAttempt,recordReceipt} from './intents.mjs';
const commands=new Map([['create',createIntent],['prepare',prepareAttempt],['expire',expireAttempt],
 ['observe-signed',observeSignedAttempt],['receipt',recordReceipt]]);
const [command,file]=process.argv.slice(2);
if(!commands.has(command)||!file)throw Error('Usage: node transactions/operator.mjs <create|prepare|expire|observe-signed|receipt> <fixture.json>');
const dir=new URL('../.local/',import.meta.url);mkdirSync(dir,{recursive:true});
const db=openDatabase(fileURLToPath(new URL('preview.sqlite',dir)));
try{console.log(JSON.stringify(await commands.get(command)(db,JSON.parse(readFileSync(file,'utf8')))));}
finally{db.close();}

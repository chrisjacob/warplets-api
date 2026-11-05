import {mkdirSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {openDatabase} from '../storage/database.mjs';
import {publishDrawPolicy} from '../randomness/selection.mjs';
import {settleBeaconDraw} from './quicknet.mjs';
const [command,path,op]=process.argv.slice(2);
if(!['publish','settle'].includes(command)||!path)throw Error('Usage: node cli.mjs publish <terms.json> | settle <signed-round.json> <operation-id>');
const dir=new URL('../.local/',import.meta.url);mkdirSync(dir,{recursive:true});const db=openDatabase(fileURLToPath(new URL('preview.sqlite',dir)));
try{const input=JSON.parse(readFileSync(path,'utf8'));console.log(JSON.stringify(command==='publish'?publishDrawPolicy(db,input):settleBeaconDraw(db,op,input)));}
finally{db.close();}

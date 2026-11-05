import {readFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {openDatabase} from '../storage/database.mjs';
import {seedBallot,recordDecision} from './ballots.mjs';
const [command,file]=process.argv.slice(2);
if(!['seed','decide'].includes(command)||!file)throw Error('Usage: node governance/operator.mjs <seed|decide> <fixture.json>');
const dir=new URL('../.local/',import.meta.url);mkdirSync(dir,{recursive:true});
const db=openDatabase(fileURLToPath(new URL('preview.sqlite',dir)));
try {
 const input=JSON.parse(readFileSync(file,'utf8'));
 console.log(JSON.stringify(command==='seed'?seedBallot(db,input):recordDecision(db,input)));
}finally{db.close();}

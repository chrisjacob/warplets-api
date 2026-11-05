import {mkdirSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {openDatabase} from '../storage/database.mjs';
import {seedFarm,observeFarm} from './farms.mjs';
const [command,file]=process.argv.slice(2);
if(!['seed','observe'].includes(command)||!file)throw Error('Usage: node stake/operator.mjs <seed|observe> <fixture.json>');
const dir=new URL('../.local/',import.meta.url);mkdirSync(dir,{recursive:true});
const db=openDatabase(fileURLToPath(new URL('preview.sqlite',dir)));
try{const input=JSON.parse(readFileSync(file,'utf8'));
 console.log(JSON.stringify(command==='seed'?seedFarm(db,input):observeFarm(db,input)));
}finally{db.close();}

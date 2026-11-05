import {readFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {openDatabase} from '../storage/database.mjs';
import {recordVaultManifest,observeAsset} from './ledger.mjs';
const [command,file]=process.argv.slice(2);
if(!['manifest','observe'].includes(command)||!file)throw Error('Usage: node vault/operator.mjs <manifest|observe> <fixture.json>');
const dir=new URL('../.local/',import.meta.url);mkdirSync(dir,{recursive:true});
const db=openDatabase(fileURLToPath(new URL('preview.sqlite',dir)));
try{
 const fixture=JSON.parse(readFileSync(file,'utf8'));
 console.log(JSON.stringify(command==='manifest'?recordVaultManifest(db,fixture):observeAsset(db,fixture)));
}finally{db.close();}

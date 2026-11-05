import { mkdirSync,readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../storage/database.mjs';
import { importQuoteEvidence,registerQuoteSource } from './evidence.mjs';
const [action,file]=process.argv.slice(2);
if(!['source','capture'].includes(action)||!file)throw Error('Usage: node quotes/operator.mjs <source|capture> <fixture.json>');
const dir=new URL('../.local/',import.meta.url);mkdirSync(dir,{recursive:true});
const db=openDatabase(fileURLToPath(new URL('preview.sqlite',dir)));
try{console.log(JSON.stringify((action==='source'?registerQuoteSource:importQuoteEvidence)(db,JSON.parse(readFileSync(file,'utf8')))));}
finally{db.close();}

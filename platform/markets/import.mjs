import {readFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {openDatabase} from '../storage/database.mjs';
import {importMarket} from './catalog.mjs';
const file=process.argv[2];
if(!file) throw new Error('Usage: node markets/import.mjs <market-fixture.json>');
const dir=new URL('../.local/',import.meta.url);
mkdirSync(dir,{recursive:true});
const db=openDatabase(fileURLToPath(new URL('preview.sqlite',dir)));
try {console.log(JSON.stringify(importMarket(db,JSON.parse(readFileSync(file,'utf8')))));} finally {db.close();}

import {mkdirSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {openDatabase} from '../storage/database.mjs';
import {registerCampaign} from './registry.mjs';
if(!process.argv[2])throw Error('Usage: node launch/record.mjs campaign-fixture.json');
const dir=new URL('../.local/',import.meta.url);mkdirSync(dir,{recursive:true});
const db=openDatabase(fileURLToPath(new URL('preview.sqlite',dir)));
try{console.log(JSON.stringify(registerCampaign(db,JSON.parse(readFileSync(process.argv[2],'utf8'))),null,2));}
finally{db.close();}

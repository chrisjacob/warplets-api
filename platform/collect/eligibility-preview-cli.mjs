import {readFileSync,statSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {previewSeasonEligibility} from './eligibility-preview.mjs';
const [database,filename]=process.argv.slice(2);
if(!database||!filename)throw Error('Usage: node collect/eligibility-preview-cli.mjs <existing.sqlite> <fixture.json>');
if(statSync(filename).size>4*1024*1024)throw Error('Preview packet exceeds 4 MiB.');
const input=JSON.parse(readFileSync(filename,'utf8')),db=new DatabaseSync(database,{readOnly:true});
try{console.log(JSON.stringify(previewSeasonEligibility(db,input),null,2));}finally{db.close();}

import { dryRunWhitelist } from './whitelist-import.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../storage/database.mjs';
import { createCollection, freezeSeasonSnapshot, fulfillMint, fulfillProgression, inspectOperation,
  observeCollectionAsset, publishCollectionStage, reserveFounderMint } from './store.mjs';

const commands={'whitelist-dry-run':(_db,input)=>dryRunWhitelist(input),create:createCollection,stage:publishCollectionStage,snapshot:freezeSeasonSnapshot,
  'founder-mint':reserveFounderMint,'mint-result':fulfillMint,'progression-result':fulfillProgression,
  observe:observeCollectionAsset,inspect:(db,input)=>inspectOperation(db,input.operationId)};
const [command,filename]=process.argv.slice(2);
if(!Object.hasOwn(commands,command)||!filename) throw Error('Usage: node collect/operator.mjs <'+Object.keys(commands).join('|')+'> <fixture.json>');
const input=JSON.parse(readFileSync(filename,'utf8'));
if(command==='whitelist-dry-run'){console.log(JSON.stringify(dryRunWhitelist(input)));process.exit(0);}
const dir=new URL('../.local/',import.meta.url);
mkdirSync(dir,{recursive:true});
const db=openDatabase(fileURLToPath(new URL('preview.sqlite',dir)));
try {console.log(JSON.stringify(commands[command](db,input)));}
finally {db.close();}

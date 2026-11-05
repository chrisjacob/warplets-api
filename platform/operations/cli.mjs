import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { openDatabase } from '../storage/database.mjs';
import { changeScope, controlledScopes, costPressure, actionDecision, recordUsage, reserveOptionalCost, settleOptionalCost } from './controls.mjs';

export function runControls(argv) {
  const [file,verb,fixture]=argv;
  const verbs={change:changeScope,meter:recordUsage,reserve:reserveOptionalCost,settle:settleOptionalCost,
    status:(db,{now})=>({pressure:costPressure(db,now),decisions:controlledScopes.map(scope=>actionDecision(db,scope,now))})};
  if(argv.length!==3||!Object.hasOwn(verbs,verb))throw Error('Use DB change|meter|reserve|settle|status INPUT.json');
  const input=JSON.parse(readFileSync(fixture,'utf8'));
  const db=openDatabase(file);
  try{return verbs[verb](db,input);}finally{db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{console.log(JSON.stringify(runControls(process.argv.slice(2)),null,2));}
  catch(error){console.error(error.message);process.exitCode=1;}
}

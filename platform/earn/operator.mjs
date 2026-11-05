import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { openDatabase } from '../storage/database.mjs';
import { addCampaign, finalizeBoard, recordAllocation, recordReview, recordStakeRead } from './workflow.mjs';
import { configureAction, registerCollection, recordOwnership, recordActionCompletion } from './components.mjs';
import { registerPosition, recordPositionEvent, reconcilePosition } from './positions.mjs';
import { recoveryMode } from './archive.mjs';

const commands = {campaign:addCampaign,stake:recordStakeRead,review:recordReview,
  finalize:finalizeBoard,allocate:recordAllocation,action:configureAction,completion:recordActionCompletion,
  collection:registerCollection,owner:recordOwnership,enroll:registerPosition,event:recordPositionEvent,position:reconcilePosition};
export function runOperator(argv) {
  const [database,action,fixture]=argv;
  if (argv.length!==3 || !Object.hasOwn(commands,action)) {
    throw new Error('Usage: node platform/earn/operator.mjs LOCAL_DATABASE '+Object.keys(commands).join('|')+' FIXTURE.json');
  }
  const input=JSON.parse(readFileSync(fixture,'utf8'));
  const db=openDatabase(database);
  try {
    if (recoveryMode(db)) throw new Error('This public archive serves existing awards. Use an operator database for fixtures.');
    return commands[action](db,input);
  }
  finally { db.close(); }
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(runOperator(process.argv.slice(2)),null,2)); }
  catch(error) { console.error(error.message);process.exitCode=1; }
}

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { openDatabase } from '../storage/database.mjs';
import { addCampaign, finalizeBoard, recordAllocation, recordMemberFacts, recordReview, recordStakeRead } from './workflow.mjs';

const commands = {campaign:addCampaign,stake:recordStakeRead,facts:recordMemberFacts,review:recordReview,
  finalize:finalizeBoard,allocate:recordAllocation};
export function runOperator(argv) {
  const [database,action,fixture]=argv;
  if (argv.length!==3 || !Object.hasOwn(commands,action)) {
    throw new Error('Usage: node platform/earn/operator.mjs LOCAL_DATABASE campaign|stake|facts|review|finalize|allocate FIXTURE.json');
  }
  const input=JSON.parse(readFileSync(fixture,'utf8'));
  const db=openDatabase(database);
  try { return commands[action](db,input); }
  finally { db.close(); }
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(runOperator(process.argv.slice(2)),null,2)); }
  catch(error) { console.error(error.message);process.exitCode=1; }
}

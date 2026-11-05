import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { costPacket, executionContextId } from './packet.mjs';
import { referenceScenarioInput } from './reference.mjs';

export function runCostCli(argv) {
  if(argv.length<1||argv.length>3)throw new Error('Use --reference, --compare, INPUT.json [--at MS], or --context-id INPUT.json.');
  if(argv[0]==='--context-id') {
    if(argv.length!==2)throw new Error('Expected one input file.');
    const input=JSON.parse(readFileSync(argv[1],'utf8'));return {contextId:executionContextId(input.context)};
  }
  const now=argv.length===3&&argv[1]==='--at'?Number(argv[2]):Date.now();
  if(argv.length===2||(argv.length===3&&argv[1]!=='--at'))throw new Error('Use --at MS for historical evaluation.');
  const input=['--reference','--compare'].includes(argv[0])?referenceScenarioInput(now):JSON.parse(readFileSync(argv[0],'utf8'));
  const packet=costPacket({...input,asOfMs:now});
  if(argv[0]!=='--compare')return packet;
  return {mode:packet.mode,asOfMs:now,referenceOnly:true,contextGaps:packet.contextGaps,
    choices:[packet.firstAtt,...[2,6,7,8,10,13,14].map(id=>packet.scenarios.find(s=>s.id===id))].map(s=>({
      scenario:s.id,name:s.name,status:s.status,payerPricedLamports:Object.fromEntries(Object.entries(s.byPayer).map(([payer,v])=>[payer,v.pricedByUnit.lamport])),
      unpricedTerms:s.lines.filter(l=>l.problems.length).map(l=>({id:l.id,problems:l.problems})),pilotBudget:s.pilotBudget,
    }))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try{console.log(JSON.stringify(runCostCli(process.argv.slice(2)),null,2));}
  catch(error){console.error(error.message);process.exitCode=1;}
}

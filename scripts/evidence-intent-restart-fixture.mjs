// Private test/study subprocess driver, not a runtime service or operator CLI.
import fs from "node:fs/promises";
import {evidenceRegularFile} from "./discovery-evidence-objects.mjs";
import {persistEvidencePublicationIntent,publishStoredEvidenceIntent,reconcileStoredEvidenceIntent} from "./discovery-evidence-intents.mjs";
const [file,mode]=process.argv.slice(2),info=await evidenceRegularFile(file,65536),handle=await fs.open(info.file,"r");let input;
try{const bytes=Buffer.alloc(info.bytes+1),read=await handle.read(bytes,0,bytes.length,0);if(read.bytesRead!==info.bytes||(await handle.stat()).size!==info.bytes)throw Error("fixture_input_size_changed");input=JSON.parse(bytes.subarray(0,read.bytesRead));}finally{await handle.close();}
globalThis.fetch=async()=>{throw Error("fixture_network_forbidden");};
if(mode==="partial_cipher"||mode==="before_ready"){
  const open=fs.open;fs.open=async function(name,flags,...args){
    if(mode==="before_ready"&&flags==="wx"&&String(name).endsWith("ready.json"))process.exit(74);
    const handle=await open(name,flags,...args);
    if(mode==="partial_cipher"&&flags==="wx"&&String(name).endsWith("intent.bin"))handle.writeFile=async bytes=>{await handle.write(bytes.subarray(0,Math.max(1,Math.floor(bytes.length/2))));process.exit(73);};
    return handle;
  };
}
try{
  let result;
  if(["persist_stop","partial_cipher","before_ready"].includes(mode)){await persistEvidencePublicationIntent(input.publication,input.journal,input.grant,input.plan);process.exit(71);}
  else if(mode==="commit_stop")await publishStoredEvidenceIntent(input.publication,input.journal,input.grant,input.id,()=>{process.exit(72);});
  else if(mode==="publish")result=await publishStoredEvidenceIntent(input.publication,input.journal,input.grant,input.id);
  else if(mode==="reconcile")result=await reconcileStoredEvidenceIntent(input.publication,input.journal,input.grant,input.id);
  else throw Error("fixture_mode_invalid");
  console.log(JSON.stringify(result));
}catch{console.error("Private intent restart fixture held.");process.exitCode=1;}

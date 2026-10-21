import test,{mock} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {createEvidenceAppendStage,stageEvidenceAppend,readStagedEvidenceAppend} from "./discovery-evidence-append-stage.mjs";

const sha=b=>createHash("sha256").update(b).digest("hex"),at="2026-10-22T02:00:00.000Z",mint="synthetic-private-mint-label-漢😀";
function input(kind="holder"){
  const table=`tenx_${kind}_evidence`,payload=JSON.stringify(kind==="holder"?{mint,inventory:{context:{slot:42}},memo:"original property order 漢😀"}:{asset:{address:mint},observed_at:at,memo:"original property order 漢😀"});
  const row=kind==="holder"?{payload_hash:sha(payload),address:mint,slot:42,payload,observed_at:at}:{payload_hash:sha(payload),address:mint,payload,observed_at:at};
  return {stageId:randomUUID(),table,row};
}
async function fixture(work){
  await fs.mkdir(".tmp",{recursive:true});const root=await fs.mkdtemp(path.resolve(".tmp","append-stage-test-")),keyFile=path.join(root,"key.bin"),key=randomBytes(32),network=mock.method(globalThis,"fetch",()=>{throw Error("provider_forbidden");});
  try{
    await fs.writeFile(keyFile,key,{flag:"wx",mode:0o600});const args={target:path.join(root,"stage"),keyFile,generation:randomUUID(),sourceArchivePin:"a".repeat(64),baseReferencePin:"b".repeat(64)},created=await createEvidenceAppendStage(args),options={directory:args.target,keyFile,contextPin:created.context_pin};
    await work({root,key,keyFile,args,created,options});assert.equal(network.mock.callCount(),0);
  }finally{
    mock.restoreAll();key.fill(0);const actual=await fs.realpath(root),base=await fs.realpath(".tmp");assert.ok(actual.startsWith(base+path.sep)&&path.basename(actual).startsWith("append-stage-test-"));await fs.rm(actual,{recursive:true,force:true});
  }
}
function held(value){assert.equal(value.published,false);assert.equal(value.evidence_admitted,false);assert.equal(value.provider_requests,0);assert.equal(value.database_writes,0);assert.equal(value.runtime_activated,false);assert.equal(value.action_authority,false);}
async function files(folder){const result={};for(const f of await fs.readdir(folder,{withFileTypes:true})){const file=path.join(folder,f.name);if(f.isDirectory())Object.assign(result,await files(file));else result[file]=await fs.readFile(file);}return result;}

for(const kind of ["holder","wallet"])test(`${kind} stages and restores exact raw bytes, metadata and hashes without publication`,()=>fixture(async f=>{
  const item=input(kind),staged=await stageEvidenceAppend(f.options,item),result=await readStagedEvidenceAppend(f.options,staged.ticket);held(f.created);held(staged);held(result);
  assert.equal(staged.reused,false);assert.equal(result.table,item.table);assert.deepEqual(result.row,item.row);assert.equal(sha(result.row.payload),item.row.payload_hash);
  for(const bytes of Object.values(await files(f.options.directory))){assert.equal(bytes.includes(Buffer.from(item.row.payload)),false);assert.equal(bytes.includes(Buffer.from(mint)),false);assert.equal(bytes.includes(f.key),false);assert.equal(bytes.includes(Buffer.from(f.key.toString("hex"))),false);}
}));
for(const kind of ["holder","wallet"])test(`${kind} retries verify and reuse the original files without replacement`,()=>fixture(async f=>{
  const item=input(kind),first=await stageEvidenceAppend(f.options,item),before=await files(f.options.directory),second=await stageEvidenceAppend(f.options,item);assert.equal(second.reused,true);assert.deepEqual(first.ticket,second.ticket);assert.deepEqual(await files(f.options.directory),before);
}));
test("holder retries with later observation times retain the first staged receipt time",()=>fixture(async f=>{
  const item=input(),first=await stageEvidenceAppend(f.options,item),later={...item,row:{...item.row,observed_at:"2026-10-22T02:01:00.000Z"}},second=await stageEvidenceAppend(f.options,later);
  assert.equal(second.reused,true);assert.deepEqual(second.ticket,first.ticket);assert.deepEqual((await readStagedEvidenceAppend(f.options,second.ticket)).row,item.row);
}));
test("a stage identity cannot be reused for different valid content",()=>fixture(async f=>{
  const item=input(),first=await stageEvidenceAppend(f.options,item),payload=JSON.stringify({...JSON.parse(item.row.payload),memo:"different content"}),other={...item,row:{...item.row,payload,payload_hash:sha(payload)}};
  const before=await files(f.options.directory);await assert.rejects(stageEvidenceAppend(f.options,other),/identity_conflict/);assert.deepEqual(await files(f.options.directory),before);assert.deepEqual((await readStagedEvidenceAppend(f.options,first.ticket)).row,item.row);
}));
test("independent stage targets with identical generation/source pins derive different contexts",()=>fixture(async f=>{
  const second=await createEvidenceAppendStage({...f.args,target:path.join(f.root,"second")});assert.notEqual(second.context_pin,f.created.context_pin);held(second);
}));
for(const change of ["hash","mint","slot","unicode","table","extra","stage_id"])test(`invalid ${change} is rejected before creating pending files`,()=>fixture(async f=>{
  const item=input();if(change==="hash")item.row.payload_hash="f".repeat(64);if(change==="mint")item.row.address="foreign mint";if(change==="slot")item.row.slot=43;if(change==="unicode"){item.row.observed_at="bad\ud800";}if(change==="table")item.table="tenx_candidates";if(change==="extra")item.row.unexpected=true;if(change==="stage_id")item.stageId="../escape";
  await assert.rejects(stageEvidenceAppend(f.options,item));assert.deepEqual(await fs.readdir(path.join(f.options.directory,"pending")),[]);
}));
test("wallet metadata cannot disagree with its hashed source observation time",()=>fixture(async f=>{
  const item=input("wallet");item.row.observed_at="2026-10-22T02:01:00.000Z";await assert.rejects(stageEvidenceAppend(f.options,item),/identity_mismatch/);
}));
test("UTF-8 byte limits reject large multibyte wallet payloads despite fewer code units",()=>fixture(async f=>{
  const item=input("wallet");item.row.payload=JSON.stringify({...JSON.parse(item.row.payload),padding:"漢".repeat(610000)});item.row.payload_hash=sha(item.row.payload);assert.ok(item.row.payload.length<1800000);
  await assert.rejects(stageEvidenceAppend(f.options,item),/byte_bound/);assert.deepEqual(await fs.readdir(path.join(f.options.directory,"pending")),[]);
}));
for(const kind of ["holder","wallet"])test(`${kind} accepts and restores its exact maximum raw byte bound`,()=>fixture(async f=>{
  const item=input(kind),body={...JSON.parse(item.row.payload),padding:""},maximum=kind==="holder"?2000000:1800000;
  body.padding="x".repeat(maximum-Buffer.byteLength(JSON.stringify(body)));item.row.payload=JSON.stringify(body);item.row.payload_hash=sha(item.row.payload);assert.equal(Buffer.byteLength(item.row.payload),maximum);
  const staged=await stageEvidenceAppend(f.options,item);assert.deepEqual((await readStagedEvidenceAppend(f.options,staged.ticket)).row,item.row);
}));
for(const phase of ["object.bin","descriptor.bin","ready.json"])test(`failure before ${phase} retains an unreferenced partial stage that cannot be overwritten`,()=>fixture(async f=>{
  const item=input(),open=fs.open,hook=mock.method(fs,"open",async(file,mode,...rest)=>{if(mode==="wx"&&String(file).endsWith(phase))throw Error("simulated_write_failure");return open(file,mode,...rest);});
  try{await assert.rejects(stageEvidenceAppend(f.options,item),/simulated_write_failure/);}finally{hook.mock.restore();}
  const before=await files(f.options.directory);await assert.rejects(stageEvidenceAppend(f.options,item));assert.deepEqual(await files(f.options.directory),before);
  assert.ok((await fs.readdir(path.join(f.options.directory,"pending"))).includes(item.stageId));await assert.rejects(fs.stat(path.join(f.options.directory,"pending",item.stageId,"ready.json")));
}));
test("lost acknowledgement after writing ready reconciles by verifying the same immutable stage",()=>fixture(async f=>{
  const item=input(),open=fs.open,hook=mock.method(fs,"open",async(file,mode,...rest)=>{if(mode==="r"&&String(file).endsWith("ready.json"))throw Error("simulated_lost_acknowledgement");return open(file,mode,...rest);});
  try{await assert.rejects(stageEvidenceAppend(f.options,item),/simulated_lost_acknowledgement/);}finally{hook.mock.restore();}
  const before=await files(f.options.directory),retried=await stageEvidenceAppend(f.options,item);assert.equal(retried.reused,true);assert.deepEqual(await files(f.options.directory),before);assert.deepEqual((await readStagedEvidenceAppend(f.options,retried.ticket)).row,item.row);held(retried);
}));
for(const filename of ["object.bin","descriptor.bin","ready.json"])test(`corrupt ${filename} never returns a row or reusable ticket`,()=>fixture(async f=>{
  const item=input(),staged=await stageEvidenceAppend(f.options,item),file=path.join(f.options.directory,"pending",item.stageId,filename),bytes=await fs.readFile(file);bytes[0]^=1;await fs.writeFile(file,bytes);
  await assert.rejects(readStagedEvidenceAppend(f.options,staged.ticket));await assert.rejects(stageEvidenceAppend(f.options,item));
}));
test("recomputed unkeyed descriptor checksums cannot forge GCM authentication",()=>fixture(async f=>{
  const item=input(),staged=await stageEvidenceAppend(f.options,item),folder=path.join(f.options.directory,"pending",item.stageId),file=path.join(folder,"descriptor.bin"),bytes=await fs.readFile(file);bytes[0]^=1;await fs.writeFile(file,bytes);
  const ready=JSON.parse(await fs.readFile(path.join(folder,"ready.json"),"utf8"));ready.descriptor.sha256=sha(bytes);const readyBytes=Buffer.from(JSON.stringify(ready)+"\n");await fs.writeFile(path.join(folder,"ready.json"),readyBytes);
  await assert.rejects(readStagedEvidenceAppend(f.options,{...staged.ticket,ticket_sha256:sha(readyBytes)}));
}));
test("descriptor reads remain bounded if a file grows after its size check",()=>fixture(async f=>{
  const item=input(),staged=await stageEvidenceAppend(f.options,item),file=path.join(f.options.directory,"pending",item.stageId,"descriptor.bin"),size=(await fs.stat(file)).size,open=fs.open;let requested=0;
  const hook=mock.method(fs,"open",async(name,mode,...rest)=>{
    const handle=await open(name,mode,...rest);
    if(String(name)===file&&mode==="r"){
      await fs.appendFile(file,Buffer.alloc(2000000,1));const read=handle.read.bind(handle);mock.method(handle,"read",async(buffer,offset,length,position)=>{requested+=length;return read(buffer,offset,length,position);});
    }
    return handle;
  });
  try{await assert.rejects(readStagedEvidenceAppend(f.options,staged.ticket),/file_size_changed/);}finally{hook.mock.restore();}
  assert.ok(requested>0&&requested<=size+1);
}));
test("copying and rehashing a staged object into a different authenticated context still fails",()=>fixture(async f=>{
  const item=input(),staged=await stageEvidenceAppend(f.options,item),target=path.join(f.root,"other"),other=await createEvidenceAppendStage({...f.args,target}),options={...f.options,directory:target,contextPin:other.context_pin},folder=path.join(target,"pending",item.stageId);await fs.mkdir(folder);
  for(const name of ["object.bin","descriptor.bin","ready.json"])await fs.copyFile(path.join(f.options.directory,"pending",item.stageId,name),path.join(folder,name));
  const ready=JSON.parse(await fs.readFile(path.join(folder,"ready.json"),"utf8"));ready.context_pin=other.context_pin;const bytes=Buffer.from(JSON.stringify(ready)+"\n");await fs.writeFile(path.join(folder,"ready.json"),bytes);
  await assert.rejects(readStagedEvidenceAppend(options,{...staged.ticket,context_pin:other.context_pin,ticket_sha256:sha(bytes)}));
  assert.deepEqual((await readStagedEvidenceAppend(f.options,staged.ticket)).row,item.row);
}));
test("wrong keys, independent context pins and foreign tickets hold without staging writes",()=>fixture(async f=>{
  const item=input(),staged=await stageEvidenceAppend(f.options,item),wrong=path.join(f.root,"wrong.bin");await fs.writeFile(wrong,randomBytes(32));const before=await files(f.options.directory);
  await assert.rejects(readStagedEvidenceAppend({...f.options,keyFile:wrong},staged.ticket),/key_mismatch/);await assert.rejects(stageEvidenceAppend({...f.options,keyFile:wrong},input()),/key_mismatch/);
  await assert.rejects(stageEvidenceAppend({...f.options,contextPin:"f".repeat(64)},input()),/context_pin_mismatch/);await assert.rejects(readStagedEvidenceAppend(f.options,{...staged.ticket,context_pin:"f".repeat(64)}),/ticket_context_mismatch/);assert.deepEqual(await files(f.options.directory),before);
}));
test("mutated generation/source bindings cannot be admitted by the original external context pin",()=>fixture(async f=>{
  const file=path.join(f.options.directory,"stage.json"),value=JSON.parse(await fs.readFile(file,"utf8"));value.generation=randomUUID();value.source_archive_pin="f".repeat(64);await fs.writeFile(file,JSON.stringify(value));
  await assert.rejects(stageEvidenceAppend(f.options,input()),/context_pin_mismatch/);
}));
test("existing targets, nested artifacts, live paths and keys inside targets are rejected",()=>fixture(async f=>{
  const before=await files(f.options.directory);await assert.rejects(createEvidenceAppendStage(f.args));assert.deepEqual(await files(f.options.directory),before);
  await assert.rejects(createEvidenceAppendStage({...f.args,target:path.join(f.options.directory,"pending","nested")}),/nested_in_artifact/);
  await fs.mkdir(path.join(f.root,".wrangler"));await assert.rejects(createEvidenceAppendStage({...f.args,target:path.join(f.root,".wrangler","forbidden")}));
  await assert.rejects(createEvidenceAppendStage({...f.args,target:f.root}),/separate_key_required/);
}));
test("a pending stage directory junction cannot redirect reads or writes",()=>fixture(async f=>{
  const item=input(),foreign=path.join(f.root,"foreign");await fs.mkdir(foreign);await fs.symlink(foreign,path.join(f.options.directory,"pending",item.stageId),"junction");
  await assert.rejects(stageEvidenceAppend(f.options,item),/links are not allowed/);assert.deepEqual(await fs.readdir(foreign),[]);
}));

import test,{mock} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {fixture,receipt,sha} from "./discovery-evidence-publication-test-helper.mjs";
import {stageEvidenceAppend} from "./discovery-evidence-append-stage.mjs";
import {publishEvidenceAppend,transferEvidencePublicationOwner} from "./discovery-evidence-publication.mjs";
import {withScratchEvidenceResolver} from "./discovery-evidence-scratch.mjs";
import {publicationEvidenceReadStore} from "./lib/evidence-publication-read-store";
import {d1EvidenceReadStore} from "../discovery/src/evidence-read-store";
import {sqliteD1} from "../app/functions/_lib/sqliteTestDb";

const mint="So11111111111111111111111111111111111111112",start="2026-10-22T00:00:00.000Z",at="2026-10-22T02:00:00.000Z";
type Fixture=Parameters<Parameters<typeof fixture>[0]>[0];
async function published(f:Fixture,kind="holder",memo="new",time=at){
  const item=receipt(kind,memo);item.row.observed_at=time;
  if(kind==="wallet"){item.row.payload=JSON.stringify({...JSON.parse(item.row.payload),observed_at:time});item.row.payload_hash=sha(item.row.payload);}
  const staged=await stageEvidenceAppend(f.stage,{stageId:randomUUID(),...item});
  await publishEvidenceAppend(f.options,f.grant,{publication_id:randomUUID(),ticket:staged.ticket,operations:[{kind:"receipt"}]});
  return {...item,ticket:staged.ticket};
}
async function admitted(f:Fixture,work:(store:ReturnType<typeof publicationEvidenceReadStore>)=>Promise<void>){
  await withScratchEvidenceResolver(f.source,async source=>{await work(publicationEvidenceReadStore(source,f.options,f.grant));return null;});
}
for(const kind of ["holder","wallet"] as const)test(`${kind}: all three contract methods match D1 across base and new receipts without writes`,()=>fixture(async f=>{
  const items=[kind==="holder"?f.baseHolder:f.baseWallet,await published(f,kind)],ordinary=d1EvidenceReadStore(sqliteD1(f.db));
  const r=items[1]!.row;
  if(kind==="holder")f.db.prepare("INSERT INTO tenx_holder_evidence VALUES(?,?,?,?,?)").run(r.payload_hash,r.address,r.slot!,r.payload,r.observed_at);
  else f.db.prepare("INSERT INTO tenx_wallet_evidence VALUES(?,?,?,?)").run(r.payload_hash,r.address,r.payload,r.observed_at);
  const before=sha(await fs.readFile(path.join(f.target,"metadata.sqlite")));
  await admitted(f,async store=>{
    const index=await store[`${kind}Index`](mint,start,at);assert.deepEqual(index,await ordinary[`${kind}Index`](mint,start,at));
    for(const item of items){
      assert.deepEqual(await store[`${kind}Receipt`](item.row.payload_hash),item.row);
      assert.equal(await store[`${kind}Receipt`](item.row.payload_hash,"wrong mint"),null);
    }
    for(const meta of index){
      // The methods have parallel signatures; each index supplies its own exact metadata.
      const read=store[`${kind}Payload`] as (meta:typeof index[number],bytes:number)=>Promise<string|null>;
      const hash="payload_hash" in meta?meta.payload_hash:meta.evidence_hash;
      assert.equal(await read(meta,meta.bytes),items.find(item=>item.row.payload_hash===hash)!.row.payload);
      assert.equal(await read(meta,meta.bytes-1),null);
      assert.equal(await read({...meta,bytes:meta.bytes+1},meta.bytes+1),null);
      await assert.rejects(read(meta,-1),/byte_bound_invalid/);
    }
    for(const absent of ["","missing","0".repeat(64)])assert.equal(await store[`${kind}Receipt`](absent),null);
    assert.deepEqual(await store[`${kind}Index`](mint,at,"2026-10-22T01:59:59.999Z"),[]);
  });
  assert.equal(sha(await fs.readFile(path.join(f.target,"metadata.sqlite"))),before);
}));
test("merged indexes retain inclusive cutoffs, ties, holder 97 and wallet newest 2 limits",()=>fixture(async f=>{
  for(let n=0;n<100;n++)await published(f,"holder",String(n));
  for(const [memo,time] of [["earlier","2026-10-22T01:00:00.000Z"],["tie-a",at],["tie-b",at],["future","2026-10-22T03:00:00.000Z"]])await published(f,"wallet",memo,time);
  await admitted(f,async store=>{
    const holders=await store.holderIndex(mint,at,at);assert.equal(holders.length,97);
    assert.deepEqual(holders.map(m=>m.payload_hash),f.copy.prepare("SELECT payload_hash FROM tenx_holder_evidence ORDER BY observed_at,slot,payload_hash LIMIT 97").all().map(r=>r.payload_hash));
    const wallets=await store.walletIndex(mint,start,at);assert.equal(wallets.length,2);assert.ok(wallets.every(m=>m.observed_at===at));
    assert.deepEqual(wallets.map(m=>m.evidence_hash),f.copy.prepare("SELECT payload_hash FROM tenx_wallet_evidence WHERE observed_at<=? ORDER BY observed_at DESC,payload_hash DESC LIMIT 2").all(at).map(r=>r.payload_hash));
  });
}));
test("index and rejected byte/mint lookups authenticate descriptors without reading payload bodies",()=>fixture(async f=>{
  const item=await published(f),file=path.join(f.stage.directory,"pending",item.ticket.stage_id,"object.bin");await fs.writeFile(file,"corrupt");
  await admitted(f,async store=>{
    const index=await store.holderIndex(mint,start,at),meta=index.find(m=>m.payload_hash===item.row.payload_hash)!;assert.ok(meta);
    assert.equal(await store.holderPayload(meta,0),null);assert.equal(await store.holderReceipt(item.row.payload_hash,"wrong"),null);
    await assert.rejects(store.holderPayload(meta,meta.bytes));await assert.rejects(store.holderReceipt(item.row.payload_hash));
  });
}));
for(const file of ["descriptor.bin","object.bin"])test(`${file} missing selected data holds instead of returning absent`,()=>fixture(async f=>{
  const item=await published(f);await fs.unlink(path.join(f.stage.directory,"pending",item.ticket.stage_id,file));
  await admitted(f,async store=>{await assert.rejects(store.holderReceipt(item.row.payload_hash));if(file==="descriptor.bin")await assert.rejects(store.holderIndex(mint,start,at));});
}));
for(const table of ["tenx_holder_evidence","tenx_append_base"])test(`deleted frozen ${table} cannot silently shorten the index`,()=>fixture(async f=>{
  f.copy.prepare(`DELETE FROM ${table} WHERE payload_hash=?`).run(f.baseHolder.row.payload_hash);
  await admitted(f,async store=>{await assert.rejects(store.holderIndex(mint,start,at),/reference_missing|baseline_missing/);await assert.rejects(store.holderReceipt(f.baseHolder.row.payload_hash),/reference_missing|baseline_missing/);});
}));
test("both frozen metadata and reference removed still fail the frozen baseline",()=>fixture(async f=>{
  for(const table of ["tenx_holder_evidence","tenx_append_base"])f.copy.prepare(`DELETE FROM ${table} WHERE payload_hash=?`).run(f.baseHolder.row.payload_hash);
  await admitted(f,async store=>{await assert.rejects(store.holderIndex(mint,start,at),/baseline_missing/);await assert.rejects(store.holderReceipt(f.baseHolder.row.payload_hash),/baseline_missing/);});
}));
test("changed frozen identity and published identity are held",()=>fixture(async f=>{
  const item=await published(f);f.copy.prepare("UPDATE tenx_holder_evidence SET slot=43").run();
  await admitted(f,async store=>{await assert.rejects(store.holderReceipt(f.baseHolder.row.payload_hash),/base_mismatch/);await assert.rejects(store.holderReceipt(item.row.payload_hash),/descriptor_mismatch/);});
}));
test("orphan published metadata/reference and overlapping authority hold",()=>fixture(async f=>{
  const item=await published(f);f.copy.prepare("DELETE FROM tenx_holder_evidence WHERE payload_hash=?").run(item.row.payload_hash);
  await admitted(f,async store=>{await assert.rejects(store.holderReceipt(item.row.payload_hash),/reference_missing/);});
  f.copy.prepare("INSERT INTO tenx_holder_evidence VALUES(?,?,?,?)").run(item.row.payload_hash,mint,42,at);
  f.copy.prepare("INSERT INTO tenx_append_base VALUES(?,?,?,?)").run(item.table,item.row.payload_hash,"0".repeat(64),100);
  await admitted(f,async store=>{await assert.rejects(store.holderReceipt(item.row.payload_hash),/overlapping/);});
}));
for(const file of ["descriptor.bin","object.bin"])test(`ownership transfer during ${file} read withholds the result`,()=>fixture(async f=>{
  const item=await published(f),open=fs.open;let transferred=false;
  const hook=mock.method(fs,"open",async(...args:Parameters<typeof fs.open>)=>{const handle=await open(...args);if(String(args[0]).endsWith(file)&&!transferred){const close=handle.close.bind(handle);handle.close=async()=>{await close();if(!transferred){transferred=true;await transferEvidencePublicationOwner(f.options,f.grant,randomUUID());}};}return handle;});
  try{await admitted(f,async store=>{await assert.rejects(file==="descriptor.bin"?store.holderIndex(mint,start,at):store.holderReceipt(item.row.payload_hash),/owner_fenced/);});}finally{hook.mock.restore();}
}));
test("stale grant blocks even absent lookups and empty indexes",()=>fixture(async f=>{
  await transferEvidencePublicationOwner(f.options,f.grant,randomUUID());
  await admitted(f,async store=>{await assert.rejects(store.holderReceipt("missing"),/owner_fenced/);await assert.rejects(store.walletIndex("missing",start,at),/owner_fenced/);});
}));
test("source manifest substitution holds before releasing even an empty selection",()=>fixture(async f=>{
  await withScratchEvidenceResolver(f.source,async source=>{
    const changed={...source,capacity:{...source.capacity,capacity_manifest_sha256:"0".repeat(64)}};
    await assert.rejects(publicationEvidenceReadStore(changed,f.options,f.grant).holderReceipt("missing"),/source_mismatch/);return null;
  });
}));
test("a concurrent append changing the selected index withholds the inconsistent result",()=>fixture(async f=>{
  await published(f);const open=fs.open;let inserted=false;
  const hook=mock.method(fs,"open",async(...args:Parameters<typeof fs.open>)=>{const handle=await open(...args);if(String(args[0]).endsWith("descriptor.bin")&&!inserted){const close=handle.close.bind(handle);handle.close=async()=>{await close();if(!inserted){inserted=true;await published(f,"holder","concurrent");}};}return handle;});
  try{await admitted(f,async store=>{await assert.rejects(store.holderIndex(mint,start,at),/selection_changed/);});}finally{hook.mock.restore();}
}));
test("repeated holder publication retains the first observation time and frozen identity",()=>fixture(async f=>{
  const item={...f.baseHolder,row:{...f.baseHolder.row,observed_at:"2026-10-22T03:00:00.000Z"}},staged=await stageEvidenceAppend(f.stage,{stageId:randomUUID(),...item});
  await publishEvidenceAppend(f.options,f.grant,{publication_id:randomUUID(),ticket:staged.ticket,operations:[{kind:"receipt"}]});
  await admitted(f,async store=>{assert.deepEqual(await store.holderReceipt(item.row.payload_hash),f.baseHolder.row);assert.equal((await store.holderIndex(mint,at,at))[0]!.observed_at,at);});
}));
test("foreign metadata and invalid byte bounds cannot resolve a published payload",()=>fixture(async f=>{
  const item=await published(f);
  await admitted(f,async store=>{
    const meta=(await store.holderIndex(mint,start,at)).find(m=>m.payload_hash===item.row.payload_hash)!;
    await fs.unlink(path.join(f.stage.directory,"pending",item.ticket.stage_id,"object.bin"));
    assert.equal(await store.holderPayload({...meta,slot:43},meta.bytes),null);
    assert.equal(await store.holderPayload({...meta,address:"11111111111111111111111111111111"},meta.bytes),null);
    for(const limit of [NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1])await assert.rejects(store.holderPayload(meta,limit),/byte_bound_invalid/);
  });
}));
test("raw new receipts retain exact NUL and multibyte metadata without granting index schema acceptance",()=>fixture(async f=>{
  const item=receipt(),address=mint+"\u0000漢😀";item.row.address=address;item.row.payload=JSON.stringify({...JSON.parse(item.row.payload),mint:address});item.row.payload_hash=sha(item.row.payload);
  const staged=await stageEvidenceAppend(f.stage,{stageId:randomUUID(),...item});await publishEvidenceAppend(f.options,f.grant,{publication_id:randomUUID(),ticket:staged.ticket,operations:[{kind:"receipt"}]});
  await admitted(f,async store=>{assert.deepEqual(await store.holderReceipt(item.row.payload_hash,address),item.row);assert.equal(await store.holderReceipt(item.row.payload_hash,mint),null);await assert.rejects(store.holderIndex(address,start,at));});
}));
test("the final ownership fence follows all asynchronous file IO before releasing index or raw results",()=>fixture(async f=>{
  const item=await published(f);
  await admitted(f,async store=>{
    const events:string[]=[],open=fs.open,prepare=DatabaseSync.prototype.prepare;
    const io=mock.method(fs,"open",async(...args:Parameters<typeof fs.open>)=>{const handle=await open(...args),close=handle.close.bind(handle);handle.close=async()=>{await close();events.push("io");};return handle;});
    const sql=mock.method(DatabaseSync.prototype,"prepare",function(this:DatabaseSync,...args:Parameters<DatabaseSync["prepare"]>){
      const statement=prepare.apply(this,args);
      if(args[0]==="SELECT generation,owner,epoch FROM tenx_append_control WHERE id=1"){
        const get=statement.get;statement.get=(...bindings:unknown[])=>{const result:ReturnType<typeof statement.get>=Reflect.apply(get,statement,bindings);events.push("fence");return result;};
      }return statement;
    });
    try{for(const read of [()=>store.holderIndex(mint,start,at),()=>store.holderReceipt(item.row.payload_hash)]){events.length=0;await read();assert.ok(events.includes("io"));assert.equal(events.at(-1),"fence");}}
    finally{sql.mock.restore();io.mock.restore();}
  });
}));

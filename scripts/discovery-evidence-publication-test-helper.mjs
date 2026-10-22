// Synthetic, migrated private targets shared by the offline read tests only.
import {mock} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {createHash,randomUUID} from "node:crypto";
import {exportArchive} from "./discovery-archive.mjs";
import {packEvidenceObjects} from "./discovery-evidence-objects.mjs";
import {createEvidenceKey,sealEvidenceObjects} from "./discovery-evidence-sealed.mjs";
import {buildEvidenceIndex} from "./discovery-evidence-index.mjs";
import {buildEvidenceReferences} from "./discovery-evidence-references.mjs";
import {studyMetadataCapacity} from "./discovery-metadata-capacity.mjs";
import {createEvidenceAppendStage} from "./discovery-evidence-append-stage.mjs";
import {createEvidencePublicationTarget} from "./discovery-evidence-publication.mjs";
export const sha=b=>createHash("sha256").update(b).digest("hex"),at="2026-10-22T02:00:00.000Z";
export function receipt(kind="holder",memo="new"){
  const payload=JSON.stringify(kind==="holder"?{mint:"So11111111111111111111111111111111111111112",inventory:{context:{slot:42}},memo}:{asset:{address:"So11111111111111111111111111111111111111112"},observed_at:at,memo});
  return {table:`tenx_${kind}_evidence`,row:kind==="holder"?{payload_hash:sha(payload),address:"So11111111111111111111111111111111111111112",slot:42,payload,observed_at:at}:{payload_hash:sha(payload),address:"So11111111111111111111111111111111111111112",payload,observed_at:at}};
}
export async function fixture(work,beforeArchive){
  await fs.mkdir(".tmp",{recursive:true});const root=await fs.mkdtemp(path.resolve(".tmp","publication-test-")),target=path.resolve(".tmp","publication-target-test-"+randomUUID()),sourceFile=path.join(root,"source.sqlite"),db=new DatabaseSync(sourceFile),network=mock.method(globalThis,"fetch",()=>{throw Error("provider_forbidden");});let copy;
  try{
    db.exec("CREATE TABLE d1_migrations(name TEXT PRIMARY KEY)");for(const name of (await fs.readdir("discovery/migrations")).filter(n=>n.endsWith(".sql")).sort())db.exec(await fs.readFile("discovery/migrations/"+name,"utf8"));
    const baseHolder=receipt("holder","base"),baseWallet=receipt("wallet","base");
    for(const item of [baseHolder,baseWallet]){const r=item.row;if("slot" in r)db.prepare("INSERT INTO tenx_holder_evidence VALUES(?,?,?,?,?)").run(r.payload_hash,r.address,r.slot,r.payload,r.observed_at);else db.prepare("INSERT INTO tenx_wallet_evidence VALUES(?,?,?,?)").run(r.payload_hash,r.address,r.payload,r.observed_at);}
    db.prepare("INSERT INTO tenx_candidates(address,pool,payload,checked_at,mode) VALUES('mint','pool','{}',?,'live')").run(at);
    db.prepare("INSERT INTO tenx_wallet_work VALUES('mint',?,'{}',?)").run(baseWallet.row.payload_hash,at);db.prepare("INSERT INTO tenx_usage VALUES('rpc','test',3)").run();db.prepare("INSERT INTO tenx_wallet_usage VALUES('test',3)").run();
    await beforeArchive?.({db,baseHolder,baseWallet});
    const archive=path.join(root,"archive"),a=await exportArchive(sourceFile,archive),objects=path.join(root,"objects"),o=await packEvidenceObjects(archive,a.manifest_sha256,objects),keyFile=path.join(root,"key.bin");await createEvidenceKey(keyFile);
    const sealedDirectory=path.join(root,"sealed"),s=await sealEvidenceObjects(objects,o.catalog_manifest_sha256,keyFile,sealedDirectory),index=path.join(root,"index"),i=await buildEvidenceIndex(sealedDirectory,s.sealed_manifest_sha256,keyFile,index),referenceDirectory=path.join(root,"references"),r=await buildEvidenceReferences(index,i.index_manifest_sha256,referenceDirectory),capacityDirectory=path.join(root,"capacity"),c=await studyMetadataCapacity(archive,a.manifest_sha256,referenceDirectory,r.reference_manifest_sha256,capacityDirectory);
    const source={capacityDirectory,capacityPin:c.capacity_manifest_sha256,referenceDirectory,referencePin:r.reference_manifest_sha256,sealedDirectory,keyFile},createdStage=await createEvidenceAppendStage({target:path.join(root,"stage"),keyFile,generation:randomUUID(),sourceArchivePin:a.manifest_sha256,baseReferencePin:r.reference_manifest_sha256}),stage={directory:path.join(root,"stage"),contextPin:createdStage.context_pin,keyFile},created=await createEvidencePublicationTarget({target,source,stage,owner:randomUUID()}),options={directory:target,targetPin:created.target_pin,stage};
    copy=new DatabaseSync(path.join(target,"metadata.sqlite"));await work({root,target,db,copy,source,stage,options,grant:created.grant,baseHolder,baseWallet});assert.equal(network.mock.callCount(),0);
  }finally{mock.restoreAll();copy?.close();db.close();for(const file of [target,root]){let actual;try{actual=await fs.realpath(file);}catch(e){if(e.code==="ENOENT")continue;throw e;}const base=await fs.realpath(".tmp");assert.ok(actual.startsWith(base+path.sep)&&/^publication-(target-)?test-/.test(path.basename(actual)));await fs.rm(actual,{recursive:true,force:true});}}
}

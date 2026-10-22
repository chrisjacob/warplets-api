// Offline Node compatibility adapter. Never imported by application/Worker code.
import {createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import type {EvidenceReadStore} from "../../discovery/src/evidence-read-store";
import {HolderArchiveMetaSchema} from "../../discovery/src/holder-history-model";
import {AcquisitionWalletMetaSchema} from "../../discovery/src/holder-acquisition-model";
import type {ScratchSession} from "../discovery-evidence-scratch.mjs";
import {selectEvidencePublication} from "../discovery-evidence-publication.mjs";
import {describeStagedEvidenceAppend,readStagedEvidenceAppend} from "../discovery-evidence-append-stage.mjs";
import {scratchEvidenceReadStore} from "./evidence-scratch-read-store";

type Options={directory:string;targetPin:string;stage:{directory:string;contextPin:string;keyFile:string}};
type Grant={generation:string;owner:string;epoch:number};
type Table="tenx_holder_evidence"|"tenx_wallet_evidence";
type Request={kind:"receipt";table:Table;hash:string;baseline:string[]}|{kind:"index";table:Table;address:string;start:string;cutoff:string;baseline:string[]};
type Selection=Awaited<ReturnType<typeof selectEvidencePublication>>;
type Selected=Selection["rows"][number];
const holder="tenx_holder_evidence",wallet="tenx_wallet_evidence";
const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
function metadata(row:Selected,table:Table){
  const m=row.meta;
  return table===holder?[m.payload_hash,m.address,m.slot,m.observed_at]:[m.payload_hash,m.address,m.observed_at];
}
export function publicationEvidenceReadStore(source:ScratchSession,options:Options,grant:Grant):EvidenceReadStore{
  const frozen=scratchEvidenceReadStore(source),authority=Object.freeze({...grant});
  async function select(request:Request){
    const result=await selectEvidencePublication(options,authority,request),c=source.capacity;
    if(!isDeepStrictEqual(result.context,{capacity_pin:c.capacity_manifest_sha256,source_archive_pin:c.source_archive_manifest_sha256,base_reference_pin:c.reference_manifest_sha256}))throw Error("publication_read_source_mismatch");
    for(const row of [...result.baseline,...result.rows]){
      if(row.source==="base"){
        const known=source.receiptIdentity(request.table,String(row.meta.payload_hash));
        if(!known||!isDeepStrictEqual(known.metadata,metadata(row,request.table))||known.bytes!==row.bytes||known.row_sha256!==row.row_sha256)throw Error("publication_read_base_mismatch");
      }else{
        const known=await describeStagedEvidenceAppend(options.stage,row.ticket);
        if(known.table!==request.table||!isDeepStrictEqual(known.metadata,metadata(row,request.table))||known.bytes!==row.bytes||known.row_sha256!==row.row_sha256)throw Error("publication_read_descriptor_mismatch");
      }
    }
    return result;
  }
  async function stable(request:Request,first:Selection){
    // Authentication happened above. The final fenced SQL snapshot must be the
    // last IO: a second asynchronous descriptor read could outlive its owner.
    if(!isDeepStrictEqual(await selectEvidencePublication(options,authority,request),first))throw Error("publication_read_selection_changed");
  }
  function receiptRequest(table:Table,hash:string):Request{
    return {kind:"receipt",table,hash,baseline:source.receiptIdentity(table,hash)?[hash]:[]};
  }
  async function resolve(table:Table,row:Selected){
    const saved=row.source==="base"?await source.resolve(table,String(row.meta.payload_hash)):(await readStagedEvidenceAppend(options.stage,row.ticket)).row;
    const {payload,...meta}=saved;
    if(!isDeepStrictEqual(meta,row.meta)||Buffer.byteLength(payload)!==row.bytes||digest(saved)!==row.row_sha256)throw Error("publication_read_row_mismatch");
    return saved;
  }
  function parsed(row:Selected,table:Table){
    const m=row.meta;
    return table===holder?HolderArchiveMetaSchema.parse({...m,bytes:row.bytes}):AcquisitionWalletMetaSchema.parse({evidence_hash:m.payload_hash,address:m.address,observed_at:m.observed_at,bytes:row.bytes});
  }
  async function index(table:Table,address:string,start:string,cutoff:string){
    const base=table===holder?await frozen.holderIndex(address,start,cutoff):await frozen.walletIndex(address,start,cutoff);
    const request:Request={kind:"index",table,address,start,cutoff,baseline:base.map(m=>"payload_hash" in m?m.payload_hash:m.evidence_hash)},first=await select(request),result=first.rows.map(row=>parsed(row,table));
    await stable(request,first);return result;
  }
  async function receipt(table:Table,hash:string,address?:string){
    const request=receiptRequest(table,hash),first=await select(request),row=first.rows[0];
    const saved=row&&(address===undefined||address===row.meta.address)?await resolve(table,row):null;
    await stable(request,first);
    if(!saved)return null;
    // Match the application contract's exact raw receipt property order.
    return table===holder?{payload_hash:saved.payload_hash,address:saved.address,slot:saved.slot!,payload:saved.payload,observed_at:saved.observed_at}:{payload_hash:saved.payload_hash,address:saved.address,payload:saved.payload,observed_at:saved.observed_at};
  }
  async function payload(table:Table,input:unknown,maximumBytes:number){
    if(!Number.isSafeInteger(maximumBytes)||maximumBytes<0)throw Error("publication_read_byte_bound_invalid");
    const meta=table===holder?HolderArchiveMetaSchema.parse(input):AcquisitionWalletMetaSchema.parse(input),hash="payload_hash" in meta?meta.payload_hash:meta.evidence_hash,request=receiptRequest(table,hash),first=await select(request),row=first.rows[0];
    const result=row&&isDeepStrictEqual(parsed(row,table),meta)&&row.bytes<=maximumBytes?(await resolve(table,row)).payload:null;
    await stable(request,first);return result;
  }
  return {
    holderIndex:async(...args)=>index(holder,...args) as ReturnType<EvidenceReadStore["holderIndex"]>,
    walletIndex:async(...args)=>index(wallet,...args) as ReturnType<EvidenceReadStore["walletIndex"]>,
    holderPayload:(...args)=>payload(holder,...args),walletPayload:(...args)=>payload(wallet,...args),
    holderReceipt:async(...args)=>receipt(holder,...args) as ReturnType<EvidenceReadStore["holderReceipt"]>,
    walletReceipt:async(...args)=>receipt(wallet,...args) as ReturnType<EvidenceReadStore["walletReceipt"]>,
  };
}

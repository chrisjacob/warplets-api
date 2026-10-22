// Fully authenticated holder context; final owner/selection check follows all IO.
import {isDeepStrictEqual} from "node:util";
import {withScratchEvidenceResolver,type ScratchOptions} from "../discovery-evidence-scratch.mjs";
import {selectEvidencePublication} from "../discovery-evidence-publication.mjs";
import {publicationEvidenceReadStore} from "./evidence-publication-read-store";
import type {ProducerPublication,ProducerGrant} from "./evidence-producer-publication";
export async function readHolderSnapshotReceipt(source:ScratchOptions,publication:ProducerPublication,grant:ProducerGrant,hash:string){
  const saved=structuredClone({source,publication,grant,hash});
  const admitted=await withScratchEvidenceResolver(saved.source,async reader=>{
    const request={kind:"receipt" as const,table:"tenx_holder_evidence" as const,hash:saved.hash,baseline:reader.receiptIdentity("tenx_holder_evidence",saved.hash)?[saved.hash]:[]},before=await selectEvidencePublication(saved.publication,saved.grant,request),row=await publicationEvidenceReadStore(reader,saved.publication,saved.grant).holderReceipt(saved.hash);
    return {request,before,row};
  });
  const {request,before,row}=admitted.value;
  if(!isDeepStrictEqual(await selectEvidencePublication(saved.publication,saved.grant,request),before))throw Error("wallet_snapshot_holder_changed");return row;
}

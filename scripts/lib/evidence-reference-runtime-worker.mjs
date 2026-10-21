// Test-only entry point. No app bindings, credentials, deployment or public routes.
import {Buffer} from "node:buffer";
import {verifyReferenceProof,MAX_REFERENCE,MAX_PROOF} from "./evidence-reference-proof.mjs";
import {recoverEvidenceBytes,evidenceHash} from "./evidence-reference-contract.mjs";
import {API_HEADERS,authorized,requireAdminBrowser} from "../../discovery/src/request-security.ts";

const SQL=`SELECT ordinal,length(CAST(reference_json AS BLOB)) AS reference_bytes,length(CAST(proof_json AS BLOB)) AS proof_bytes,CASE WHEN length(CAST(reference_json AS BLOB))<=${MAX_REFERENCE} THEN reference_json END AS reference_json,CASE WHEN length(CAST(proof_json AS BLOB))<=${MAX_PROOF} THEN proof_json END AS proof_json FROM study_references WHERE generation=? AND table_name=? AND identity=?`;
const GENERATION_SQL="SELECT generation,manifest_pin FROM study_generations WHERE case_id=?";
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:API_HEADERS});
export default {async fetch(request,env){
  const url=new URL(request.url),trace=[];let objectReads=0;
  if(!["localhost","127.0.0.1"].includes(url.hostname))return response({state:"denied"},403);
  if(!authorized(request,env.STUDY_TOKEN))return response({state:"denied"},401);
  // RPC proxy filters hostile Origin headers before dispatch. This negative-only
  // fixture invokes the actual shared browser guard inside the worker instead.
  const browserHeaders=new Headers(request.headers);
  if(url.searchParams.get("__bad_origin")==="1")browserHeaders.set("origin","https://evil.test");
  try{requireAdminBrowser(new Request(request,{headers:browserHeaders}));}catch{return response({state:"denied"},403);}
  if(request.method!=="GET")return response({state:"denied"},405);
  if(url.pathname!=="/study/reference")return response({state:"denied"},404);
  const caseId=url.searchParams.get("case"),grant=Object.hasOwn(env.STUDY_GRANTS,caseId)?env.STUDY_GRANTS[caseId]:null;
  if(!grant)return response({state:"held",reason:"unknown_grant",trace,object_reads:0,action_authority:false},409);
  const now=Date.parse(env.STUDY_NOW),expires=Date.parse(grant.expires_at);
  if(!Number.isFinite(now)||!Number.isFinite(expires)||expires<=now||expires>now+60000||url.searchParams.get("__expired")==="1")return response({state:"held",reason:"expired_grant",trace,object_reads:0,action_authority:false},409);
  const query=async(kind,sql,...args)=>{const result=await env.STUDY_DB.prepare(sql).bind(...args).all();trace.push({kind,rows_read:result.meta.rows_read??null,rows_written:result.meta.rows_written??null,duration_ms:result.meta.duration??null,returned_rows:result.results.length});return result.results[0];};
  const matches=row=>row?.generation===grant.generation&&row?.manifest_pin===grant.pin;
  try{
    if(!matches(await query("generation_before",GENERATION_SQL,grant.case_id)))throw Error("generation_changed");
    const saved=await query("reference",SQL,grant.generation,grant.table,grant.identity);
    if(!saved)throw Error("reference_missing_no_absence_proof");
    if(!saved.reference_json||!saved.proof_json||saved.reference_bytes>MAX_REFERENCE||saved.proof_bytes>MAX_PROOF)throw Error("reference_bounds");
    const reference=verifyReferenceProof(grant.manifest,grant.pin,JSON.parse(saved.reference_json),JSON.parse(saved.proof_json),grant.table,grant.identity);
    if(reference.ordinal!==saved.ordinal)throw Error("ordinal_mismatch");
    if(url.searchParams.get("__race")==="after_reference")await env.STUDY_DB.prepare("UPDATE study_generations SET generation='changed' WHERE case_id=?").bind(grant.case_id).run();
    const blob=await env.STUDY_OBJECTS.get(reference.sealed.sha256);objectReads++;
    if(!blob||blob.size!==reference.sealed.bytes||blob.size>2100000)throw Error("object_bounds_or_missing");
    const {ordinal:ignored,...value}=reference,key=Buffer.from(env.STUDY_KEY,"hex");let row;
    try{row=recoverEvidenceBytes(value,Buffer.from(await blob.arrayBuffer()),key);}finally{key.fill(0);}
    if(url.searchParams.get("__race")==="after_payload")await env.STUDY_DB.prepare("UPDATE study_generations SET manifest_pin=? WHERE case_id=?").bind("0".repeat(64),grant.case_id).run();
    if(!matches(await query("generation_after",GENERATION_SQL,grant.case_id)))throw Error("generation_changed");
    const serialized=JSON.stringify(row);
    return response({state:"available",row_sha256:evidenceHash(serialized),serialized_row_bytes:Buffer.byteLength(serialized),trace,object_reads:objectReads,
      reference_bytes:saved.reference_bytes,proof_bytes:saved.proof_bytes,proof_hashes:JSON.parse(saved.proof_json).length,index_bytes_hashed:0,
      encrypted_catalog_bytes_read:0,other_references_verified:false,other_objects_verified:false,action_authority:false,runtime_activated:false});
  }catch(error){return response({state:"held",reason:error.message==="generation_changed"?"generation_changed":"evidence_validation_held",trace,object_reads:objectReads,action_authority:false},409);}
}};

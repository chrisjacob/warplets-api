// Cached loopback reads and read-only local SQLite replay; never calls providers.
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {MintReviewsResponse} from "../discovery/src/mint-review-model";
import {StatusResponse} from "../app/src/discovery/client";
import {DEFAULT_POLICY} from "../discovery/src/model";
import {curveAddress,migrations,WSOL} from "../discovery/src/pump";
import {SignatureRows,TransactionSchema} from "../discovery/src/rpc";
import {hashJson} from "../discovery/src/solana";
const base="http://127.0.0.1:8794/api/10x";
async function get(path:string){const r=await fetch(`${base}/${path}`,{signal:AbortSignal.timeout(30000)});assert.equal(r.status,200);assert.equal(r.headers.get("cache-control"),"no-store");return r.json();}
const reviews=MintReviewsResponse.parse(await get("discovery/mint-reviews")).data,status=StatusResponse.parse(await get("system/status")).data;
assert.deepEqual(status.policy,DEFAULT_POLICY);assert.equal(reviews.provider_requests,0);assert.equal(reviews.evidence_gates_changed,false);
const db=new DatabaseSync(new URL("../discovery/.wrangler/local/v3/d1/miniflare-D1DatabaseObject/daf636fcbef1c9ac586f35b886cf4aab026d59a97e006ac52cad422db0bcaf4c.sqlite",import.meta.url),{readOnly:true});
let pageReceipts=0,migrationBodies=0;
try{
  for(const review of reviews.reviews){
    assert.equal(review.curve,await curveAddress(review.address));
    const pages=db.prepare("SELECT payload,payload_hash FROM tenx_mint_review_pages WHERE address=? ORDER BY page").all(review.address) as {payload:string;payload_hash:string}[];
    assert.ok(pages.length<=reviews.limits.pages);
    for(const row of pages){const payload=JSON.parse(row.payload);assert.equal(await hashJson(payload),row.payload_hash);assert.ok(SignatureRows.parse(payload).length<=reviews.limits.page_size);pageReceipts++;}
    const receipts=db.prepare("SELECT signature,outcome,payload_hash FROM tenx_mint_review_reads WHERE address=? AND outcome IN ('migration_verified','unsupported_quote')").all(review.address) as {signature:string;outcome:string;payload_hash:string}[];
    for(const receipt of receipts){
      const saved=db.prepare("SELECT payload,payload_hash FROM tenx_evidence WHERE signature=?").get(receipt.signature) as {payload:string;payload_hash:string}|undefined;assert.ok(saved);
      const raw=JSON.parse(saved.payload);assert.equal(await hashJson(raw),saved.payload_hash);assert.equal(saved.payload_hash,receipt.payload_hash);
      const tx=TransactionSchema.parse(raw),migration=(await migrations(tx)).find(m=>m.address===review.address);assert.ok(migration);assert.equal(tx.transaction.signatures[0],receipt.signature);
      if(receipt.outcome==="migration_verified")assert.equal(migration.quote,WSOL);else assert.notEqual(migration.quote,WSOL);migrationBodies++;
    }
  }
}finally{db.close();}
console.log(JSON.stringify({reviews:reviews.reviews.map(r=>({address:r.address,state:r.state,candidate_present:r.candidate_present})),reserved_today:reviews.reserved_today,page_receipts_replayed:pageReceipts,migration_bodies_replayed:migrationBodies,source_requests:0,evidence_gates_changed:false},null,2));

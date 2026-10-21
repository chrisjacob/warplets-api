import assert from "node:assert/strict";
import {DetailResponse,StatusResponse} from "../app/src/discovery/client";
import {Address} from "../discovery/src/model";
import {CandidateExpirySchema} from "../discovery/src/candidate-expiry-model";
import {hashJson} from "../discovery/src/solana";

const base="http://127.0.0.1:8794/api/10x";
async function get(path:string){const response=await fetch(`${base}/${path}`,{signal:AbortSignal.timeout(30000)});assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"no-store");return response.json();}
const status=StatusResponse.parse(await get("system/status")),inventory=status.data.inventory;
assert.ok(inventory,"Local migration 0035 and the current Worker are required");
assert.equal(inventory.retained,inventory.active+inventory.expired);
assert.equal(inventory.active_over_limit,inventory.active>inventory.active_limit);
let checked:null|{address:string;receipt_hash:string}=null;
if(process.argv[2]){
  const address=Address.parse(process.argv[2]),detail=DetailResponse.parse(await get(`candidates/solana/${address}`));
  assert.ok(detail.retention,"Expected a retained expired token");
  const {receipt_hash,...raw}=detail.retention,receipt=CandidateExpirySchema.parse(raw);
  assert.equal(receipt.address,address);assert.equal(await hashJson(receipt),receipt_hash);
  assert.ok(Date.parse(receipt.expired_at)-Date.parse(receipt.creation.block_time)>86400000);
  assert.equal(detail.data.creation?.payload_hash,receipt.creation.payload_hash);
  assert.equal(detail.data.creation?.signature,receipt.creation.signature);
  assert.ok(detail.data.reasons.includes("token_older_than_24h"));
  checked={address,receipt_hash};
}
console.log(JSON.stringify({inventory,expired_detail_checked:checked,source_requests:0,evidence_gates_changed:false,deploy:false},null,2));

import { syntheticBundle } from "./fixtures";
import { TOKEN, migrations } from "./pump";
import { hashJson, publicKey, toBase58 } from "./solana";
import type { HolderEvidence } from "./holders";
import type { HolderHistoryInput } from "./holder-history-model";
export const holderKey = (n: number) => toBase58(new Uint8Array(32).fill(n));
export function historyAccount(n: number, owner: string, mint: string, amount: bigint) {
  const bytes = new Uint8Array(165);bytes.set(publicKey(mint));bytes.set(publicKey(owner),32);
  new DataView(bytes.buffer).setBigUint64(64,amount,true);bytes[108]=1;
  return {pubkey:holderKey(n),account:{owner:TOKEN,executable:false,space:165,data:[btoa(String.fromCharCode(...bytes)),"base64"] as [string,"base64"]}};
}
export async function holderHistoryFixture() {
  const at = new Date("2026-10-21T08:00:00.000Z"), bundle = await syntheticBundle(at), migration = (await migrations(bundle.graduation))[0]!;
  const sets = [[1,2],[1,3,4],[1,3]], rows = [];
  for(let i=0;i<sets.length;i++) {
    const owners=sets[i]!, slot=30000+i*1000;
    const evidence:HolderEvidence={mint:bundle.mint,pool:bundle.pool,program:TOKEN,creator:holderKey(1),
      inventory:{context:{slot},value:[...owners.map(n=>historyAccount(n,holderKey(n),bundle.mint,100_000_000n)),
        {...historyAccount(250,bundle.pool,bundle.mint,1_000_000_000n-BigInt(owners.length)*100_000_000n),pubkey:migration.baseVault}]},
      mint_state:{context:{slot:slot+1},value:[structuredClone(bundle.accounts.value[0]!)]}};
    rows.push({evidence,observed_at:new Date(at.getTime()+i*1_800_000).toISOString()});
  }
  return historyInput(rows,"2026-10-21T09:05:00.000Z");
}
export async function historyInput(rows:{evidence:HolderEvidence;observed_at:string}[],cutoff_at:string):Promise<HolderHistoryInput> {
  const samples=await Promise.all(rows.map(async row=>({payload_hash:await hashJson(row.evidence),evidence:row.evidence})));
  return {version:"holder-history-input-v1",address:rows[0]!.evidence.mint,cutoff_at,selection:"first_and_latest_two_within_24h",
    index:rows.map((row,i)=>({payload_hash:samples[i]!.payload_hash,address:row.evidence.mint,slot:row.evidence.inventory.context.slot,
      observed_at:row.observed_at,bytes:new TextEncoder().encode(JSON.stringify(row.evidence)).length})),samples};
}

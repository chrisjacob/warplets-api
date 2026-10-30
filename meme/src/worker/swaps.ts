import { canonical } from "../shared/canonical";
import {
  reviewSwapQuote,
  type SwapQuote,
  type SwapRisk,
} from "../shared/swapQuote";
import {
  bindSwapInstructions,
  type SwapContext,
  type SwapPlan,
} from "../shared/swapPacket";
import {
  validatePacket,
  messageBytes,
  type PreparedPacket,
} from "../shared/packets";
import { decode58 } from "../shared/base58";
import type { MarketDefinition } from "../shared/markets";
import type {
  SimulationEvidence,
  ChainObservation,
} from "../shared/transactions";
import { one, sha, json, requireThat, type Database } from "./db";
import { operator } from "./rounds";
export interface SwapReview {
  quote: SwapQuote;
  risk: SwapRisk;
  market: MarketDefinition;
  context: SwapContext;
  plan: SwapPlan;
  packet: PreparedPacket;
}
interface Order {
  id: string;
  state: string;
  payload: string;
  plan_hash: string;
  packet_hash: string;
  signature: string | null;
  revision: number;
  simulation: string | null;
}
export interface SwapAdapter {
  simulate(plan: SwapPlan, hash: string): Promise<SimulationEvidence>;
  inspect(
    plan: SwapPlan,
    hash: string,
    signature: string | null,
  ): Promise<ChainObservation>;
}
export const swapId = (network: string, wallet: string, key: string) =>
  sha(canonical({ network, wallet, key })).then((hash) => "swap:" + hash);
export async function getSwap(db: Database, id: string) {
  const row = await one<Order>(
    db,
    "SELECT id,state,payload,plan_hash,packet_hash,signature,revision,simulation FROM meme_swap_orders WHERE id=?",
    id,
  );
  requireThat(row, 404, "Swap review not found");
  return row;
}
async function transition(
  db: Database,
  row: Order,
  state: string,
  evidence: unknown,
  changes: { simulation?: string; signature?: string } = {},
) {
  const statements = [
    db
      .prepare(
        "UPDATE meme_swap_orders SET state=?,revision=revision+1,updated_at=?,simulation=COALESCE(?,simulation),signature=COALESCE(?,signature) WHERE id=? AND revision=?",
      )
      .bind(
        state,
        Date.now(),
        changes.simulation ?? null,
        changes.signature ?? null,
        row.id,
        row.revision,
      ),
    db
      .prepare(
        "INSERT OR IGNORE INTO meme_swap_events SELECT id,revision,state,?,updated_at FROM meme_swap_orders WHERE id=? AND revision=?",
      )
      .bind(canonical(evidence), row.id, row.revision + 1),
  ];
  const result = await db.batch(statements);
  requireThat(
    result[0].meta.changes === 1,
    409,
    "Swap changed concurrently; inspect current state",
  );
  return getSwap(db, row.id);
}
export async function prepareSwap(
  db: Database,
  key: string,
  review: SwapReview,
) {
  requireThat(
    typeof key === "string" && /^[A-Za-z0-9:._-]{8,100}$/.test(key),
    400,
    "Stable swap operation key required",
  );
  const { quote: q, plan, packet } = review,
    id = await swapId(q.network, q.wallet, key),
    bytes = canonical(review),
    existing = await one<Order>(
      db,
      "SELECT id,state,payload,plan_hash,packet_hash,signature,revision,simulation FROM meme_swap_orders WHERE id=?",
      id,
    );
  if (existing) {
    requireThat(
      existing.payload === bytes,
      409,
      "Operation key has a different immutable review",
    );
    return existing;
  }
  requireThat(bytes.length <= 300000, 413, "Swap review too large");
  reviewSwapQuote(q, review.market, q.wallet, review.risk);
  bindSwapInstructions(plan, q, review.context);
  requireThat(
    plan.subject === key &&
      plan.businessKey === `${q.network}:swap:${q.wallet}:${key}` &&
      Number.isSafeInteger(plan.notBefore) &&
      plan.notBefore >= 0 &&
      plan.notBefore <= Date.now() &&
      plan.expected.quoteHash === (await sha(canonical(q))) &&
      plan.expected.preconditionHash === review.context.sourceHash,
    400,
    "Swap operation/effects are not bound to the quote",
  );
  const planHash = await sha(canonical(plan)),
    packetHash = "packet:" + (await sha(canonical(packet)));
  await validatePacket(plan, id + ":attempt:1", planHash, packet);
  requireThat(
    !(await one(
      db,
      "SELECT id FROM meme_swap_orders WHERE network=? AND wallet=? AND state IN('prepared','awaiting_approval','submitted','unknown')",
      q.network,
      q.wallet,
    )),
    409,
    "Reconcile or cancel the existing swap before preparing another",
  );
  await db.batch([
    db
      .prepare(
        "INSERT OR IGNORE INTO meme_swap_orders(id,operation_key,network,wallet,plan_hash,packet_hash,payload,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'prepared',?,?)",
      )
      .bind(
        id,
        key,
        q.network,
        q.wallet,
        planHash,
        packetHash,
        bytes,
        Date.now(),
        Date.now(),
      ),
    db
      .prepare(
        "INSERT OR IGNORE INTO meme_swap_events VALUES(?,0,'prepared',?,?)",
      )
      .bind(id, canonical({ planHash, packetHash }), Date.now()),
  ]);
  return getSwap(db, id);
}
export async function simulateSwap(
  db: Database,
  id: string,
  adapter: SwapAdapter,
) {
  const row = await getSwap(db, id);
  requireThat(row.state === "prepared", 409, "Swap is already handed off");
  const review = JSON.parse(row.payload) as SwapReview;
  reviewSwapQuote(
    review.quote,
    review.market,
    review.quote.wallet,
    review.risk,
  );
  const result = await adapter.simulate(review.plan, row.plan_hash);
  requireThat(
    result.success &&
      result.planHash === row.plan_hash &&
      result.packetHash === row.packet_hash &&
      result.expectedHash === (await sha(canonical(review.plan.expected))) &&
      /^(0|[1-9]\d{0,25})$/.test(result.cost) &&
      BigInt(result.cost) <= BigInt(review.plan.maximumCost) &&
      Number.isSafeInteger(result.observedAt) &&
      result.observedAt <= Date.now() + 1000 &&
      Date.now() - result.observedAt <= 60000,
    409,
    "Simulation does not prove this exact reviewed swap",
  );
  return transition(
    db,
    row,
    "prepared",
    { simulation: result },
    { simulation: canonical(result) },
  );
}
export async function handoffSwap(
  db: Database,
  id: string,
  read: () => Promise<{
    packetHash: string;
    genesisHash: string;
    contextSlot: number;
    blockHeight: number;
    blockhashValid: boolean;
    observedAt: number;
    preconditionHash: string;
  }>,
) {
  const row = await getSwap(db, id),
    r = JSON.parse(row.payload) as SwapReview;
  requireThat(
    r.quote.network === "solana-local",
    403,
    "Mainnet swap signing is disabled",
  );
  requireThat(
    row.state === "prepared" && row.simulation,
    409,
    "Fresh simulation required",
  );
  reviewSwapQuote(r.quote, r.market, r.quote.wallet, r.risk);
  const sim = JSON.parse(row.simulation) as SimulationEvidence,
    lifetime = await read(),
    now = Date.now();
  requireThat(
    sim.packetHash === row.packet_hash &&
      now - sim.observedAt <= 60000 &&
      now < r.quote.expiresAt &&
      lifetime.packetHash === row.packet_hash &&
      lifetime.genesisHash === r.packet.genesisHash &&
      lifetime.blockhashValid === true &&
      Number.isSafeInteger(lifetime.blockHeight) &&
      lifetime.blockHeight >= 0 &&
      lifetime.blockHeight <= r.packet.lifetime.lastValidBlockHeight &&
      Number.isSafeInteger(lifetime.contextSlot) &&
      lifetime.contextSlot >= r.packet.lifetime.contextSlot &&
      Number.isSafeInteger(lifetime.observedAt) &&
      lifetime.observedAt <= now + 1000 &&
      now - lifetime.observedAt <= 15000 &&
      lifetime.preconditionHash === r.context.sourceHash,
    409,
    "Swap packet expired or pool/preflight evidence changed",
  );
  return transition(db, row, "awaiting_approval", {
    approval: "local-disposable-controller",
    lifetime,
    quoteHash: await sha(canonical(r.quote)),
  });
}
export async function recordSwapSignature(
  db: Database,
  id: string,
  signature: string,
) {
  const row = await getSwap(db, id);
  if (row.signature === signature) return row;
  requireThat(
    ["awaiting_approval", "submitted", "unknown"].includes(row.state) &&
      row.signature === null,
    409,
    "Swap has no active handoff or already has a signature",
  );
  const r = JSON.parse(row.payload) as SwapReview,
    key = await crypto.subtle.importKey(
      "raw",
      decode58(r.quote.wallet, 32),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
  requireThat(
    await crypto.subtle.verify(
      "Ed25519",
      key,
      decode58(signature, 64),
      messageBytes(r.packet.messageBase64),
    ),
    409,
    "Signature does not authorize the reviewed swap",
  );
  return transition(db, row, "submitted", { signature }, { signature });
}
export async function reconcileSwap(
  db: Database,
  id: string,
  adapter: SwapAdapter,
) {
  const row = await getSwap(db, id);
  if (["confirmed", "failed", "cancelled"].includes(row.state)) return row;
  requireThat(
    ["awaiting_approval", "submitted", "unknown"].includes(row.state),
    409,
    "Swap has not been handed off",
  );
  const r = JSON.parse(row.payload) as SwapReview;
  let proof: ChainObservation;
  try {
    proof = await adapter.inspect(r.plan, row.plan_hash, row.signature);
  } catch {
    return transition(db, row, "unknown", {
      reason: "Read unavailable; submission unresolved",
    });
  }
  const bound =
    proof.network === r.plan.network &&
    proof.planHash === row.plan_hash &&
    proof.signature === row.signature &&
    row.signature !== null &&
    proof.commitment === "finalized" &&
    proof.complete === true;
  if (
    bound &&
    proof.status === "finalized" &&
    proof.expectedHash === (await sha(canonical(r.plan.expected)))
  ) {
    await db.batch([
      db
        .prepare(
          "INSERT OR IGNORE INTO meme_swap_receipts SELECT id,?,?,? FROM meme_swap_orders WHERE id=? AND revision=?",
        )
        .bind(row.signature, canonical(proof), Date.now(), id, row.revision),
      db
        .prepare(
          "UPDATE meme_swap_orders SET state='confirmed',revision=revision+1,updated_at=? WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM meme_swap_receipts WHERE order_id=?)",
        )
        .bind(Date.now(), id, row.revision, id),
      db
        .prepare(
          "INSERT OR IGNORE INTO meme_swap_events SELECT id,revision,state,?,updated_at FROM meme_swap_orders WHERE id=? AND revision=?",
        )
        .bind(canonical(proof), id, row.revision + 1),
    ]);
    return getSwap(db, id);
  }
  return transition(
    db,
    row,
    bound && proof.status === "failed" ? "failed" : "unknown",
    { proof },
  );
}
export async function cancelSwap(db: Database, id: string) {
  const row = await getSwap(db, id);
  if (row.state === "cancelled") return row;
  requireThat(
    row.state === "prepared",
    409,
    "Reconcile a handed-off swap before replacement",
  );
  return transition(db, row, "cancelled", {
    reason: "Unsent review cancelled",
  });
}
export async function swapsRequest(
  db: Database,
  request: Request,
): Promise<Response | null> {
  const match = new URL(request.url).pathname.match(
    /^\/api\/meme\/operator\/swaps\/(swap%3A[a-f0-9]{64}|swap:[a-f0-9]{64})$/i,
  );
  if (!match) return null;
  await operator(db, request);
  requireThat(
    request.method === "GET",
    405,
    "Swap signing and submission endpoints are disabled",
  );
  const order = await getSwap(db, decodeURIComponent(match[1]));
  return json({ order, signingEnabled: false, mainnetEnabled: false });
}

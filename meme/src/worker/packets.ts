import { canonical } from "../shared/canonical";
import { validatePacket, type PreparedPacket } from "../shared/packets";
import type { TransactionPlan } from "../shared/transactions";
import { one, sha, json, payload, requireThat, type Database } from "./db";
import { operator } from "./rounds";

export async function activePacket(db: Database, attemptId: string) {
  return one<{ id: string; payload: string }>(
    db,
    "SELECT p.id,p.payload FROM meme_transaction_packet_heads h JOIN meme_transaction_packets p ON p.id=h.packet_id WHERE h.attempt_id=?",
    attemptId,
  );
}
export async function attachPacket(
  db: Database,
  intentId: string,
  packet: PreparedPacket,
) {
  const intent = await one<{
    current_attempt: string;
    revision: number;
    state: string;
  }>(
    db,
    "SELECT current_attempt,revision,state FROM meme_transaction_intents WHERE id=?",
    intentId,
  );
  requireThat(intent, 404, "Intent not found");
  const attempt = await one<{ plan: string; plan_hash: string }>(
    db,
    "SELECT plan,plan_hash FROM meme_transaction_attempts WHERE id=?",
    intent.current_attempt,
  );
  requireThat(attempt, 409, "Attempt missing");
  const bytes = canonical(packet),
    id = "packet:" + (await sha(bytes)),
    active = await activePacket(db, intent.current_attempt);
  if (active?.id === id) return { id, replayed: true };
  requireThat(
    ["prepared", "awaiting_approval"].includes(intent.state),
    409,
    "Reconcile a handed-off transaction before replacing its packet",
  );
  await validatePacket(
    JSON.parse(attempt.plan) as TransactionPlan,
    intent.current_attempt,
    attempt.plan_hash,
    packet,
  );
  const result = await db.batch([
    db
      .prepare(
        "INSERT OR IGNORE INTO meme_transaction_packets SELECT ?,current_attempt,?,?,?,? FROM meme_transaction_intents WHERE id=? AND revision=? AND state IN('prepared','awaiting_approval') AND NOT EXISTS(SELECT 1 FROM meme_transaction_approvals WHERE attempt_id=current_attempt)",
      )
      .bind(
        id,
        attempt.plan_hash,
        packet.messageHash,
        bytes,
        Date.now(),
        intentId,
        intent.revision,
      ),
    db
      .prepare(
        "INSERT INTO meme_transaction_packet_heads SELECT current_attempt,? FROM meme_transaction_intents WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM meme_transaction_packets WHERE id=?) ON CONFLICT(attempt_id) DO UPDATE SET packet_id=excluded.packet_id",
      )
      .bind(id, intentId, intent.revision, id),
    db
      .prepare(
        "UPDATE meme_transaction_intents SET state='prepared',simulation=NULL,chain_status='prepared',revision=revision+1,updated_at=? WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM meme_transaction_packet_heads WHERE attempt_id=current_attempt AND packet_id=?)",
      )
      .bind(Date.now(), intentId, intent.revision, id),
    db
      .prepare(
        "INSERT OR IGNORE INTO meme_transaction_events(intent_id,revision,at,state,evidence) SELECT id,revision,updated_at,state,? FROM meme_transaction_intents WHERE id=? AND revision=?",
      )
      .bind(
        canonical({ packetId: id, messageHash: packet.messageHash }),
        intentId,
        intent.revision + 1,
      ),
  ]);
  requireThat(
    result[2].meta.changes === 1,
    409,
    "Concurrent packet change; review the current attempt",
  );
  return { id, replayed: false };
}
export async function packetsRequest(
  db: Database,
  request: Request,
): Promise<Response | null> {
  const match = new URL(request.url).pathname.match(
    /^\/api\/meme\/operator\/transactions\/([^/]{1,240})\/packet$/,
  );
  if (!match) return null;
  await operator(db, request);
  const id = decodeURIComponent(match[1]);
  requireThat(/^tx:[a-f0-9]{64}$/.test(id), 400, "Invalid intent id");
  if (request.method === "POST") {
    const input = await payload(request, ["packet"], 300000);
    return json(await attachPacket(db, id, input.packet as PreparedPacket));
  }
  requireThat(request.method === "GET", 405, "Method not allowed");
  const row = await one<{ current_attempt: string }>(
    db,
    "SELECT current_attempt FROM meme_transaction_intents WHERE id=?",
    id,
  );
  requireThat(row, 404, "Intent not found");
  const packet = await activePacket(db, row.current_attempt);
  return json({
    packet: packet ? { id: packet.id, ...JSON.parse(packet.payload) } : null,
    signingEnabled: false,
    mainnetEnabled: false,
  });
}

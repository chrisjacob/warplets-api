import type {
  TransactionReadAdapter,
  TransactionPlan,
} from "../shared/transactions";
import {
  getIntent,
  simulateIntent,
  beginHandoff,
  recordSignature,
  reconcileIntent,
} from "./transactions";
import { requireThat, type Database } from "./db";
/** Sequential, bounded controller. The submit callback is supplied by a local harness,
 * never by a public request, and mainnet handoff remains rejected by the intent layer. */
export async function runClaimBatch(
  db: Database,
  ids: string[],
  adapter: TransactionReadAdapter,
  submit: (plan: TransactionPlan) => Promise<string>,
  cursor = 0,
) {
  requireThat(
    Array.isArray(ids) &&
      ids.length > 0 &&
      ids.length <= 100 &&
      new Set(ids).size === ids.length &&
      ids.every((id) => typeof id === "string" && /^tx:[a-f0-9]{64}$/.test(id)),
    400,
    "Distinct prepared claim intents required",
  );
  requireThat(
    Number.isSafeInteger(cursor) && cursor >= 0 && cursor < ids.length,
    400,
    "Valid claim cursor required",
  );
  const results: { id: string; state: string }[] = [];
  let next = cursor;
  for (; next < Math.min(ids.length, cursor + 10); next++) {
    let intent = await getIntent(db, ids[next]);
    requireThat(
      intent.operation === "claim" && intent.network.endsWith("-local"),
      403,
      "Only local claim intents are supported",
    );
    if (intent.state === "unknown" || intent.state === "submitted")
      intent = await reconcileIntent(db, intent.id, adapter);
    if (intent.state === "prepared")
      intent = await simulateIntent(db, intent.id, adapter);
    if (intent.state === "awaiting_approval") {
      const plan = JSON.parse(intent.plan) as TransactionPlan;
      try {
        await beginHandoff(db, intent.id);
        const signature = await submit(plan);
        await recordSignature(db, intent.id, signature);
        intent = await reconcileIntent(db, intent.id, adapter);
      } catch {
        // A lost response can occur after any durable step. Inspect durable state;
        // never infer failure or call the wallet again from this exception alone.
        intent = await getIntent(db, intent.id);
      }
    }
    results.push({ id: intent.id, state: intent.state });
    if (!["confirmed", "failed"].includes(intent.state))
      return {
        results,
        nextCursor: next,
        complete: false,
        needsReconciliation: true,
      };
  }
  return {
    results,
    nextCursor: next < ids.length ? next : null,
    complete: next === ids.length,
    needsReconciliation: false,
  };
}

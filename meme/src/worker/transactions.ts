import { canonical } from "../shared/canonical";
import type {
  TransactionPlan,
  TransactionState,
  TransactionReadAdapter,
} from "../shared/transactions";
import {
  one,
  rows,
  requireThat,
  sha,
  json,
  payload,
  type Database,
} from "./db";
import { operator } from "./rounds";
import { decode58 } from "../shared/base58";

interface Intent {
  id: string;
  business_key: string;
  network: string;
  operation: string;
  subject: string;
  plan: string;
  plan_hash: string;
  state: TransactionState;
  simulation: string | null;
  signature: string | null;
  revision: number;
  created_at: number;
  updated_at: number;
  attempt_id: string;
  attempt: number;
  chain_status: string;
}
const amount = (v: unknown): v is string =>
  typeof v === "string" && /^(0|[1-9][0-9]*)$/.test(v) && v.length <= 78;
export function validatePlan(p: TransactionPlan) {
  requireThat(
    p &&
      p.version === 1 &&
      ["base-local", "solana-local", "base-mainnet", "solana-mainnet"].includes(
        p.network,
      ),
    400,
    "Supported transaction network required",
  );
  requireThat(
    ["launch", "create-distributor", "fund", "claim"].includes(p.operation),
    400,
    "Unsupported operation",
  );
  requireThat(
    typeof p.subject === "string" &&
      /^[A-Za-z0-9:._-]{1,200}$/.test(p.subject) &&
      typeof p.businessKey === "string" &&
      /^[A-Za-z0-9:._-]{1,240}$/.test(p.businessKey),
    400,
    "Immutable business identity required",
  );
  requireThat(
    p.businessKey === `${p.network}:${p.operation}:${p.subject}`,
    400,
    "Business key must bind network, operation and subject",
  );
  requireThat(
    p.simulated === p.network.endsWith("-local"),
    400,
    "Mainnet and simulation must remain distinct",
  );
  requireThat(
    p.costUnit === (p.network.startsWith("base-") ? "wei" : "lamports") &&
      amount(p.maximumCost),
    400,
    "Exact native cost ceiling required",
  );
  requireThat(
    Number.isSafeInteger(p.notBefore) &&
      p.notBefore >= 0 &&
      Number.isSafeInteger(p.expiresAt) &&
      p.expiresAt > Math.max(p.notBefore, Date.now()),
    400,
    "Valid transaction window required",
  );
  const address = (v: unknown) => {
    if (typeof v !== "string") return false;
    if (p.network.startsWith("base-")) return /^0x[0-9a-fA-F]{40}$/.test(v);
    try {
      return decode58(v, 32).length === 32;
    } catch {
      return false;
    }
  };
  requireThat(
    Array.isArray(p.signers) &&
      p.signers.length > 0 &&
      p.signers.length <= 4 &&
      p.signers.every(address) &&
      new Set(p.signers).size === p.signers.length,
    400,
    "Explicit distinct signers required",
  );
  requireThat(
    Array.isArray(p.instructions) &&
      p.instructions.length > 0 &&
      p.instructions.length <= 20 &&
      p.instructions.every(
        (i) =>
          i &&
          address(i.program) &&
          Array.isArray(i.accounts) &&
          i.accounts.length <= 64 &&
          i.accounts.every(
            (a) =>
              a &&
              address(a.address) &&
              typeof a.signer === "boolean" &&
              typeof a.writable === "boolean" &&
              (!a.signer || p.signers.includes(a.address)),
          ) &&
          typeof i.data === "string" &&
          /^(?:[a-f0-9]{2})*$/.test(i.data) &&
          i.data.length <= 16384 &&
          typeof i.description === "string" &&
          i.description.length > 0 &&
          i.description.length <= 240,
      ),
    400,
    "Decoded bounded instructions with explicit account privileges required",
  );
  requireThat(
    p.expected &&
      typeof p.expected === "object" &&
      !Array.isArray(p.expected) &&
      Object.keys(p.expected).length > 0 &&
      Object.keys(p.expected).length <= 40 &&
      Object.entries(p.expected).every(
        ([k, v]) =>
          /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(k) &&
          typeof v === "string" &&
          v.length <= 256,
      ),
    400,
    "Expected state changes required",
  );
  if (p.operation === "fund")
    requireThat(
      /^[a-f0-9]{64}$/.test(p.expected.preconditionHash ?? ""),
      400,
      "Funding requires a committed distributor configuration precondition",
    );
  requireThat(
    Object.keys(p).sort().join(",") ===
      [
        "version",
        "network",
        "operation",
        "subject",
        "businessKey",
        "signers",
        "instructions",
        "expected",
        "maximumCost",
        "costUnit",
        "notBefore",
        "expiresAt",
        "simulated",
      ]
        .sort()
        .join(","),
    400,
    "Unexpected transaction fields",
  );
}
export async function getIntent(db: Database, id: string) {
  const intent = await one<Intent>(
    db,
    `SELECT i.id,i.business_key,i.network,i.operation,i.subject,a.plan,a.plan_hash,i.state,i.simulation,i.signature,i.revision,i.created_at,i.updated_at,i.current_attempt attempt_id,a.ordinal attempt,i.chain_status FROM meme_transaction_intents i JOIN meme_transaction_attempts a ON a.id=i.current_attempt WHERE i.id=?`,
    id,
  );
  requireThat(intent, 404, "Transaction intent not found");
  return intent;
}
export async function prepareIntent(db: Database, plan: TransactionPlan) {
  validatePlan(plan);
  const encoded = canonical(plan),
    hash = await sha(encoded),
    id = "tx:" + hash;
  await db.batch([
    db
      .prepare(
        "INSERT OR IGNORE INTO meme_transaction_intents(id,business_key,network,operation,subject,plan,plan_hash,state,simulation,signature,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'prepared',NULL,NULL,0,?,?)",
      )
      .bind(
        id,
        plan.businessKey,
        plan.network,
        plan.operation,
        plan.subject,
        encoded,
        hash,
        Date.now(),
        Date.now(),
      ),
    db
      .prepare(
        "INSERT OR IGNORE INTO meme_transaction_attempts SELECT id||':attempt:0',id,0,'initial',plan,plan_hash,NULL,'Initial immutable review record',created_at FROM meme_transaction_intents WHERE id=?",
      )
      .bind(id),
    db
      .prepare(
        "UPDATE meme_transaction_intents SET current_attempt=id||':attempt:0' WHERE id=? AND current_attempt IS NULL",
      )
      .bind(id),
    db
      .prepare(
        "INSERT OR IGNORE INTO meme_transaction_events(intent_id,revision,at,state,evidence) SELECT id,0,created_at,'prepared',? FROM meme_transaction_intents WHERE id=?",
      )
      .bind(canonical({ planHash: hash }), id),
  ]);
  const intent = await one<Intent>(
    db,
    "SELECT * FROM meme_transaction_intents WHERE business_key=?",
    plan.businessKey,
  );
  requireThat(
    intent?.plan_hash === hash,
    409,
    "Business operation already has a different immutable intent",
  );
  return getIntent(db, intent.id);
}
async function transition(
  db: Database,
  old: Intent,
  state: TransactionState,
  evidence: unknown,
  extra: {
    simulation?: string;
    signature?: string;
    chainStatus?: string;
    approval?: boolean;
  } = {},
) {
  const encoded = canonical(evidence);
  requireThat(
    encoded.length <= 8192,
    400,
    "Bounded transaction evidence required",
  );
  const result = await db.batch([
    db
      .prepare(
        "UPDATE meme_transaction_intents SET state=?,revision=revision+1,updated_at=?,simulation=COALESCE(?,simulation),signature=COALESCE(?,signature),chain_status=? WHERE id=? AND revision=? AND state=? AND current_attempt=?",
      )
      .bind(
        state,
        Date.now(),
        extra.simulation ?? null,
        extra.signature ?? null,
        extra.chainStatus ?? state,
        old.id,
        old.revision,
        old.state,
        old.attempt_id,
      ),
    db
      .prepare(
        "INSERT OR IGNORE INTO meme_transaction_events(intent_id,revision,at,state,evidence) SELECT id,revision,updated_at,state,? FROM meme_transaction_intents WHERE id=? AND revision=? AND state=?",
      )
      .bind(encoded, old.id, old.revision + 1, state),
    ...(extra.approval
      ? [
          db
            .prepare(
              "INSERT OR IGNORE INTO meme_transaction_approvals SELECT ?,?,?,'local-test-controller',?,? WHERE EXISTS(SELECT 1 FROM meme_transaction_intents WHERE id=? AND revision=? AND current_attempt=? AND state='unknown')",
            )
            .bind(
              old.attempt_id,
              old.plan_hash,
              await sha(old.simulation!),
              Date.now(),
              JSON.parse(old.plan).expiresAt,
              old.id,
              old.revision + 1,
              old.attempt_id,
            ),
        ]
      : []),
  ]);
  requireThat(
    result[0].meta.changes === 1,
    409,
    "Concurrent transaction transition; reconcile first",
  );
  const next = await getIntent(db, old.id);
  requireThat(
    next.revision === old.revision + 1 && next.state === state,
    409,
    "Concurrent transaction transition; reconcile first",
  );
  return next;
}
export async function simulateIntent(
  db: Database,
  id: string,
  adapter: TransactionReadAdapter,
) {
  const intent = await getIntent(db, id);
  requireThat(
    intent.state === "prepared",
    409,
    "Intent already simulated or handed off",
  );
  const plan = JSON.parse(intent.plan) as TransactionPlan;
  requireThat(Date.now() < plan.expiresAt, 409, "Intent expired");
  const result = await adapter.simulate(plan, intent.plan_hash);
  requireThat(
    result.success &&
      result.planHash === intent.plan_hash &&
      result.expectedHash === (await sha(canonical(plan.expected))) &&
      amount(result.cost) &&
      BigInt(result.cost) <= BigInt(plan.maximumCost) &&
      typeof result.context === "string" &&
      result.context.length > 0 &&
      result.context.length <= 256 &&
      Number.isSafeInteger(result.observedAt) &&
      Math.abs(Date.now() - result.observedAt) <= 60000,
    409,
    "Simulation failed, stale, mismatched or exceeds cost ceiling",
  );
  return transition(db, intent, "awaiting_approval", result, {
    simulation: canonical(result),
  });
}
/** Reserve before opening a wallet prompt: a lost response must be treated as ambiguous. */
export async function beginHandoff(
  db: Database,
  id: string,
  verifyPreconditions?: () => Promise<{
    planHash: string;
    observedHash: string;
    observedAt: number;
    context: string;
  }>,
) {
  const intent = await getIntent(db, id),
    plan = JSON.parse(intent.plan) as TransactionPlan;
  requireThat(
    intent.network.endsWith("-local"),
    403,
    "Mainnet signing handoff requires a separately approved test packet; no mainnet execution adapter is enabled",
  );
  requireThat(
    intent.state === "awaiting_approval" &&
      Date.now() >= plan.notBefore &&
      Date.now() < plan.expiresAt,
    409,
    "Not approved-ready, not released, or expired",
  );
  requireThat(
    intent.simulation &&
      Date.now() - JSON.parse(intent.simulation).observedAt <= 60000,
    409,
    "Resimulate a stale transaction in a separately reviewed attempt",
  );
  let preflight = null;
  if (plan.operation === "fund") {
    requireThat(
      verifyPreconditions,
      409,
      "Re-read distributor configuration before funding",
    );
    preflight = await verifyPreconditions();
    requireThat(
      preflight.planHash === intent.plan_hash &&
        preflight.observedHash === plan.expected.preconditionHash &&
        Number.isSafeInteger(preflight.observedAt) &&
        Math.abs(Date.now() - preflight.observedAt) <= 15000 &&
        typeof preflight.context === "string" &&
        preflight.context.length > 0 &&
        preflight.context.length <= 256,
      409,
      "Funding preconditions changed or are stale",
    );
    requireThat(
      Date.now() < plan.expiresAt &&
        Date.now() - JSON.parse(intent.simulation!).observedAt <= 60000,
      409,
      "Resimulate after slow funding preflight",
    );
  }
  return transition(
    db,
    intent,
    "unknown",
    {
      reason: "Wallet handoff reserved; inspect before retry",
      attemptId: intent.attempt_id,
      preflight,
    },
    { approval: true },
  );
}
export async function recordSignature(
  db: Database,
  id: string,
  signature: string,
) {
  const intent = await getIntent(db, id);
  if (intent.signature === signature) return intent;
  requireThat(
    intent.state === "unknown" && intent.signature === null,
    409,
    "Submission already recorded; reconcile first",
  );
  let valid = false;
  if (typeof signature === "string") {
    if (intent.network.startsWith("base-"))
      valid = /^0x[0-9a-f]{64}$/i.test(signature);
    else
      try {
        valid = decode58(signature, 64).length === 64;
      } catch {
        /* Rejected below. */
      }
  }
  requireThat(valid, 400, "Invalid transaction signature");
  return transition(db, intent, "submitted", { signature }, { signature });
}
/** Explicit local retry only after complete chain failure/expiry reconciliation. */
export async function retryFailedIntent(db: Database, id: string) {
  const old = await getIntent(db, id),
    plan = JSON.parse(old.plan) as TransactionPlan;
  requireThat(
    old.network.endsWith("-local"),
    403,
    "No mainnet retry adapter is enabled",
  );
  requireThat(
    old.state === "failed" && Date.now() < plan.expiresAt,
    409,
    "Reconcile first; an expired intent requires a new reviewed recovery plan",
  );
  return renewIntentAttempt(db, id, plan, {
    key: `failed:${old.attempt}:${old.revision}`,
    reason: "Explicit retry of fully reconciled failed attempt",
  });
}
/** A new attempt never changes economics, destinations, instructions or a business identity.
 * Before submission, expiry may be explicitly renewed. After handoff, reconcile first. */
export async function renewIntentAttempt(
  db: Database,
  id: string,
  plan: TransactionPlan,
  review: { key: string; reason: string },
) {
  const old = await getIntent(db, id);
  requireThat(
    old.network.endsWith("-local"),
    403,
    "No mainnet retry adapter is enabled",
  );
  requireThat(
    /^[A-Za-z0-9:._-]{8,160}$/.test(review.key) &&
      typeof review.reason === "string" &&
      review.reason.trim().length >= 8 &&
      review.reason.length <= 500,
    400,
    "Explicit bounded recovery review required",
  );
  validatePlan(plan);
  const bytes = canonical(plan),
    hash = await sha(bytes);
  const prior = await one<{ id: string; plan_hash: string; reason: string }>(
    db,
    "SELECT id,plan_hash,reason FROM meme_transaction_attempts WHERE intent_id=? AND recovery_key=?",
    id,
    review.key,
  );
  if (prior) {
    requireThat(
      prior.plan_hash === hash &&
        prior.reason === review.reason &&
        prior.id === old.attempt_id,
      409,
      "Recovery key is changed or superseded",
    );
    return old;
  }
  const original = JSON.parse(old.plan) as TransactionPlan;
  const economics = (p: TransactionPlan) => canonical({ ...p, expiresAt: 0 });
  requireThat(
    economics(original) === economics(plan),
    409,
    "Retry cannot alter immutable business terms",
  );
  requireThat(
    ["failed", "prepared", "awaiting_approval"].includes(old.state),
    409,
    "Reconcile ambiguous or submitted attempts before retry",
  );
  const attemptId = `${id}:attempt:${old.attempt + 1}`;
  const result = await db.batch([
    db
      .prepare(
        "INSERT INTO meme_transaction_attempts SELECT ?,id,?,?,?, ?,signature,?,? FROM meme_transaction_intents WHERE id=? AND revision=? AND current_attempt=? AND state IN('failed','prepared','awaiting_approval') AND NOT EXISTS(SELECT 1 FROM meme_financial_receipts WHERE intent_id=?)",
      )
      .bind(
        attemptId,
        old.attempt + 1,
        review.key,
        bytes,
        hash,
        review.reason,
        Date.now(),
        id,
        old.revision,
        old.attempt_id,
        id,
      ),
    db
      .prepare(
        "UPDATE meme_transaction_intents SET state='prepared',simulation=NULL,signature=NULL,chain_status='prepared',current_attempt=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND current_attempt=? AND EXISTS(SELECT 1 FROM meme_transaction_attempts WHERE id=?)",
      )
      .bind(attemptId, Date.now(), id, old.revision, old.attempt_id, attemptId),
    db
      .prepare(
        "INSERT OR IGNORE INTO meme_transaction_events(intent_id,revision,at,state,evidence) SELECT id,revision,updated_at,state,? FROM meme_transaction_intents WHERE id=? AND revision=? AND current_attempt=?",
      )
      .bind(
        canonical({
          reason: review.reason,
          previousSignature: old.signature,
          previousAttempt: old.attempt_id,
          attemptId,
          planHash: hash,
        }),
        id,
        old.revision + 1,
        attemptId,
      ),
  ]);
  requireThat(
    result[0].meta.changes === 1 && result[1].meta.changes === 1,
    409,
    "Concurrent retry; reconcile first",
  );
  return getIntent(db, id);
}
export async function reconcileIntent(
  db: Database,
  id: string,
  adapter: TransactionReadAdapter,
) {
  const intent = await getIntent(db, id);
  if (intent.state === "confirmed" || intent.state === "failed") return intent;
  requireThat(
    ["unknown", "submitted"].includes(intent.state),
    409,
    "No submission to reconcile",
  );
  const plan = JSON.parse(intent.plan) as TransactionPlan,
    result = await adapter.inspect(plan, intent.plan_hash, intent.signature);
  requireThat(
    result.network === plan.network &&
      result.planHash === intent.plan_hash &&
      result.expectedHash === (await sha(canonical(plan.expected))) &&
      result.context.length > 0 &&
      result.context.length <= 256 &&
      (intent.signature === null || result.signature === intent.signature),
    409,
    "Chain evidence does not match immutable intent",
  );
  if (
    result.status === "pending" ||
    (result.status === "absent" && !(result.expired && result.complete))
  ) {
    const status = result.status === "absent" ? "unknown" : result.status;
    return intent.chain_status === status
      ? intent
      : transition(db, intent, intent.state, result, { chainStatus: status });
  }
  if (result.status === "confirmed") {
    requireThat(
      result.signature && intent.signature === result.signature,
      409,
      "Recover and record the observed signature before confirmation",
    );
    return transition(db, intent, "submitted", result, {
      chainStatus: "confirmed",
    });
  }
  if (result.status === "absent")
    requireThat(
      Date.now() >= plan.expiresAt,
      409,
      "Cannot prove absence before intent expiry",
    );
  if (result.status === "finalized") {
    requireThat(
      result.complete && result.signature && Date.now() >= plan.notBefore,
      409,
      "Incomplete or premature confirmation",
    );
    requireThat(
      intent.signature === result.signature,
      409,
      "Recover and record the observed signature before confirmation",
    );
    const evidenceHash = await sha(canonical(result));
    await db.batch([
      db
        .prepare(
          "INSERT OR IGNORE INTO meme_financial_receipts SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM meme_transaction_intents WHERE id=? AND revision=? AND signature=? AND state IN('unknown','submitted'))",
        )
        .bind(
          intent.business_key,
          id,
          intent.operation,
          intent.subject,
          intent.signature,
          evidenceHash,
          Date.now(),
          id,
          intent.revision,
          intent.signature,
        ),
      db
        .prepare(
          "UPDATE meme_transaction_intents SET state='confirmed',chain_status='finalized',revision=revision+1,updated_at=? WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM meme_financial_receipts WHERE intent_id=? AND signature=?)",
        )
        .bind(Date.now(), id, intent.revision, id, intent.signature),
      db
        .prepare(
          "INSERT OR IGNORE INTO meme_transaction_events(intent_id,revision,at,state,evidence) SELECT id,revision,updated_at,state,? FROM meme_transaction_intents WHERE id=? AND state='confirmed'",
        )
        .bind(canonical(result), id),
    ]);
    return getIntent(db, id);
  }
  requireThat(
    (result.status === "failed" &&
      result.complete &&
      result.signature !== null) ||
      result.status === "absent",
    409,
    "Unknown or incomplete chain outcome",
  );
  if (result.status === "failed")
    requireThat(
      intent.signature === result.signature,
      409,
      "Recover and record the observed signature before failure reconciliation",
    );
  return transition(db, intent, "failed", result);
}
export async function transactionsRequest(
  db: Database,
  request: Request,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path !== "/api/meme/operator/transactions") return null;
  await operator(db, request);
  if (request.method === "GET")
    return json({
      mode: "local-review",
      signingEnabled: false,
      mainnetEnabled: false,
      intents: await rows(
        db,
        "SELECT i.id,i.network,i.operation,i.subject,a.plan_hash,i.state,i.chain_status,i.signature,i.current_attempt,a.ordinal attempt,i.created_at,i.updated_at FROM meme_transaction_intents i JOIN meme_transaction_attempts a ON a.id=i.current_attempt ORDER BY i.created_at DESC,i.id LIMIT 100",
      ),
    });
  requireThat(request.method === "POST", 405, "Method not allowed");
  const input = await payload(request, ["plan"]);
  const plan = input.plan as TransactionPlan;
  return json({
    intent: await prepareIntent(db, plan),
    signingEnabled: false,
    mainnetEnabled: false,
  });
}

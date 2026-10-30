import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./testDb";
import { control, changeControl } from "./controls";
import { reserveSource, heliusAdapter } from "./sourceAdapters";
import { vote } from "./rounds";
import { enqueue, claimJob, runJob, tick } from "./operations";
import {
  beginTick,
  finishTick,
  readiness,
  readinessRequest,
} from "./readiness";
import worker from "./index";
import { sha } from "./db";
const origin = "http://localhost:8797";
const request = (path: string, body?: unknown, token = "operator") =>
  new Request(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      origin,
      "content-type": "application/json",
      authorization: "Bearer " + token,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const environment = (db: D1Database): Env => ({
  MEME_DB: db,
  LOCAL_PREVIEW_ONLY: "true",
  LOCAL_PARTICIPATION_ENABLED: "true",
  LOCAL_OPERATIONS_ENABLED: "false",
  MEME_QA_ORIGIN: "",
  MEME_QA_FIDS: "",
  MEME_QA_GATEWAY_TOKEN: "",
  HELIUS_API_KEY: "",
  PYTH_API_KEY: "",
});
test("lost control responses replay once; stale receipts cannot undo a newer decision", async () => {
  const t = testDb();
  try {
    const p = {
      key: "pause-request-001",
      name: "participation",
      paused: true,
      expectedVersion: 0,
      reason: "Supervised pause",
    };
    t.interruptNextBatch();
    await assert.rejects(changeControl(t.db, p, "operator"), /lost response/);
    assert.equal((await control(t.db, "participation")).paused, 1);
    const replay = await changeControl(t.db, p, "operator");
    assert.equal(replay.replayed, true);
    assert.equal(replay.control.version, 1);
    await assert.rejects(
      changeControl(t.db, { ...p, reason: "Changed" }, "operator"),
      /payload changed/,
    );
    await changeControl(
      t.db,
      { ...p, key: "resume-request-001", paused: false, expectedVersion: 1 },
      "operator",
    );
    const old = await changeControl(t.db, p, "operator");
    assert.equal(old.change.paused, true);
    assert.equal(old.control.paused, false);
    assert.equal(old.control.version, 2);
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_control_changes").get()!.n,
      2,
    );
    assert.equal(
      t.raw
        .prepare(
          "SELECT COUNT(*) n FROM meme_audit WHERE action='safety-control'",
        )
        .get()!.n,
      2,
    );
    assert.throws(
      () => t.raw.exec("DELETE FROM meme_control_changes"),
      /immutable/,
    );
    for (const name of ["launching", "funding", "claims"])
      await assert.rejects(
        changeControl(
          t.db,
          { ...p, key: "financial-request", name },
          "operator",
        ),
        /non-financial/,
      );
  } finally {
    t.close();
  }
});
test("concurrent control changes use one version and one audited receipt", async () => {
  const t = testDb();
  try {
    const p = {
      name: "serving",
      paused: true,
      expectedVersion: 0,
      reason: "Concurrent fixture",
    };
    const results = await Promise.allSettled([
      changeControl(t.db, { ...p, key: "concurrent-request-a" }, "operator"),
      changeControl(t.db, { ...p, key: "concurrent-request-b" }, "operator"),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await control(t.db, "serving")).version, 1);
    assert.equal(
      t.raw
        .prepare(
          "SELECT COUNT(*) n FROM meme_audit WHERE action='safety-control'",
        )
        .get()!.n,
      1,
    );
    const changes = t.raw.prepare("SELECT total_changes() n").get()!.n;
    await changeControl(
      t.db,
      {
        name: "participation",
        paused: true,
        expectedVersion: 0,
        reason: "Pause new votes",
        key: "pause-votes-request",
      },
      "operator",
    );
    const afterPause = t.raw.prepare("SELECT total_changes() n").get()!.n;
    assert(Number(afterPause) > Number(changes));
    await assert.rejects(
      vote(t.db, "not-yet-existing", 42, "a", "valid-vote-key"),
      /Participation is paused/,
    );
    assert.equal(
      t.raw.prepare("SELECT total_changes() n").get()!.n,
      afterPause,
    );
    assert.equal((await control(t.db, "collection")).paused, 0);
  } finally {
    t.close();
  }
});
test("collection pause blocks provider calls and preserves consumed allowances on resume", async (context) => {
  const t = testDb();
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw Error("External calls forbidden");
  });
  try {
    t.raw.exec(
      "UPDATE meme_source_budgets SET ceiling=100,approval='SIMULATED allowance';",
    );
    await reserveSource(t.db, "helius", 10);
    await changeControl(
      t.db,
      {
        name: "collection",
        paused: true,
        key: "collection-pause-001",
        reason: "Hold collection",
        expectedVersion: 0,
      },
      "operator",
    );
    for (const provider of ["helius", "pyth"] as const)
      await assert.rejects(
        reserveSource(t.db, provider, 10),
        /Collection is paused/,
      );
    await assert.rejects(
      heliusAdapter(t.db, "disposable-not-real-key").page({
        wallet: "1".repeat(32),
        fromAt: 0,
        throughAt: Date.now(),
        cursor: null,
      }),
      /Collection is paused/,
    );
    assert.equal(calls, 0);
    assert.equal(
      t.raw
        .prepare("SELECT used FROM meme_source_budgets WHERE provider='helius'")
        .get()!.used,
      10,
    );
    await changeControl(
      t.db,
      {
        name: "collection",
        paused: false,
        key: "collection-resume-001",
        reason: "Resume fixture",
        expectedVersion: 1,
      },
      "operator",
    );
    await reserveSource(t.db, "helius", 10);
    assert.equal(
      t.raw
        .prepare("SELECT used FROM meme_source_budgets WHERE provider='helius'")
        .get()!.used,
      20,
    );
    t.raw.exec(
      "UPDATE meme_source_budgets SET ceiling=0 WHERE provider='pyth'",
    );
    await assert.rejects(
      reserveSource(t.db, "pyth", 1),
      /allowance unavailable/,
    );
  } finally {
    t.close();
  }
});
test("a pause between lease claim and execution drains safely and resumes the same job", async () => {
  const t = testDb(),
    now = Date.now();
  try {
    const body = {
      id: "prepared-fixture",
      opensAt: now + 60000,
      closesAt: now + 3600000,
      attribute: "cast",
      simulated: true,
      candidates: [
        {
          id: "a",
          name: "Fixture",
          symbol: "QA",
          ogMint: "1".repeat(32),
          evidence: "SIMULATED",
        },
      ],
    };
    await enqueue(t.db, "prepare-fixture", "prepare", body.id, body, now);
    const lease = await claimJob(t.db, now);
    assert(lease);
    await changeControl(
      t.db,
      {
        key: "pause-operations-001",
        name: "operations",
        paused: true,
        expectedVersion: 0,
        reason: "Drain work",
      },
      "operator",
    );
    assert.equal((await readiness(t.db, now)).operations.draining, true);
    assert.equal((await runJob(t.db, lease, now)).state, "paused");
    assert.equal(await claimJob(t.db, now), null);
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_rounds").get()!.n,
      0,
    );
    assert.equal((await tick(t.db, now)).state, "paused");
    assert.equal(
      (await readiness(t.db, now)).operations.heartbeat?.outcome,
      "paused",
    );
    await changeControl(
      t.db,
      {
        key: "resume-operations-001",
        name: "operations",
        paused: false,
        expectedVersion: 1,
        reason: "Resume saved work",
      },
      "operator",
    );
    const resumed = await claimJob(t.db, now);
    assert(resumed);
    assert.equal(resumed.id, lease.id);
    assert.equal((await runJob(t.db, resumed, now)).state, "done");
    assert.equal((await runJob(t.db, lease, now)).state, "stale");
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_rounds").get()!.n,
      1,
    );
  } finally {
    t.close();
  }
});
test("serving pause preserves private recovery routes and cannot enable financial actions", async () => {
  const t = testDb();
  try {
    t.raw
      .prepare("INSERT INTO meme_operator_tokens VALUES(?,?,?)")
      .run(await sha("operator"), "local fixture", Date.now());
    await changeControl(
      t.db,
      {
        key: "serving-pause-001",
        name: "serving",
        paused: true,
        expectedVersion: 0,
        reason: "Pause reads",
      },
      "operator",
    );
    for (const method of ["GET", "HEAD"])
      assert.equal(
        (
          await worker.fetch(
            new Request(origin + "/api/meme/preview", { method }),
            environment(t.db),
          )
        ).status,
        503,
      );
    assert.equal(
      (await worker.fetch(request("/api/auth/session"), environment(t.db)))
        .status,
      200,
    );
    const health = await worker.fetch(
      request("/api/meme/operator/operations/health"),
      environment(t.db),
    );
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("cache-control"), "no-store");
    assert.equal(
      ((await health.json()) as { productionReady: boolean }).productionReady,
      false,
    );
    await assert.rejects(
      readinessRequest(
        t.db,
        new Request(
          "https://private-qa.trycloudflare.com/api/meme/operator/operations/health",
          { headers: { authorization: "Bearer operator" } },
        ),
      ),
      /Local operator/,
    );
    assert.equal(
      (
        await worker.fetch(
          request("/api/meme/operator/operations/health", undefined, "wrong"),
          environment(t.db),
        )
      ).status,
      403,
    );
    const outside = new Request(
      origin + "/api/meme/operator/operations/controls",
      {
        method: "POST",
        headers: {
          origin: "https://evil.test",
          authorization: "Bearer operator",
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    assert.equal((await worker.fetch(outside, environment(t.db))).status, 403);
  } finally {
    t.close();
  }
});
test("readiness is redacted, read-only and reports budget/job/transaction blockers", async () => {
  const t = testDb(),
    now = Date.now(),
    secret = "SENTINEL_PRIVATE_NEVER_REPORT";
  try {
    await enqueue(
      t.db,
      "diagnostic-job",
      "prepare",
      "round",
      { apiKey: secret },
      now - 300000,
    );
    t.raw
      .prepare("UPDATE meme_jobs SET state='blocked',last_error=?")
      .run(secret);
    t.raw.prepare("UPDATE meme_source_budgets SET approval=?").run(secret);
    t.raw
      .prepare(
        "INSERT INTO meme_transaction_intents(id,business_key,network,operation,subject,plan,plan_hash,state,created_at,updated_at) VALUES('t','solana-local:claim:t','solana-local','claim','t',?,'hash','unknown',?,?)",
      )
      .run(JSON.stringify({ secret }), now, now);
    await changeControl(
      t.db,
      {
        key: "redaction-request-001",
        name: "collection",
        paused: true,
        expectedVersion: 0,
        reason: secret,
      },
      secret,
    );
    const before = t.raw.prepare("SELECT total_changes() n").get()!.n;
    t.queries.length = 0;
    const report = await readiness(t.db, now);
    assert.equal(report.status, "attention");
    assert.equal(report.productionReady, false);
    assert.equal(JSON.stringify(report).includes(secret), false);
    assert.equal(t.queries.length, 12);
    assert.equal(report.growth.notifications.realDeliveryEnabled, false);
    assert.equal(report.growth.notifications.registered, false);
    assert(t.queries.every((q) => q.startsWith("SELECT")));
    assert(report.alerts.some((a) => a.code === "jobs-blocked"));
    assert(
      report.alerts.some((a) => a.code === "transactions-need-reconciliation"),
    );
    assert(report.sources.budgets.every((b) => b.remaining === 0));
    assert.deepEqual(report.financialActions, {
      launching: false,
      funding: false,
      claims: false,
    });
    assert.equal(t.raw.prepare("SELECT total_changes() n").get()!.n, before);
  } finally {
    t.close();
  }
});
test("older heartbeat completion cannot hide a newer running tick", async () => {
  const t = testDb(),
    now = Date.now();
  try {
    const old = await beginTick(t.db, now),
      fresh = await beginTick(t.db, now + 15000);
    const obsolete = await beginTick(t.db, now - 1);
    await finishTick(t.db, obsolete, "idle", now + 15001);
    await finishTick(t.db, old, "error", now + 15001);
    assert.equal(
      (await readiness(t.db, now + 15002)).operations.heartbeat?.running,
      true,
    );
    await finishTick(t.db, fresh, "idle", now + 15003);
    await finishTick(t.db, fresh, "error", now + 15004);
    const report = await readiness(t.db, now + 15003);
    assert.equal(report.operations.heartbeat?.running, false);
    assert.equal(report.operations.heartbeat?.outcome, "idle");
    const errorTick = await beginTick(t.db, now + 30000);
    await finishTick(t.db, errorTick, "error", now + 30001);
    assert(
      (await readiness(t.db, now + 30002)).alerts.some(
        (a) => a.code === "runner-error",
      ),
    );
  } finally {
    t.close();
  }
});
test("idle ticks coalesce heartbeat writes while control checks remain live", async () => {
  const t = testDb(),
    now = Date.now();
  try {
    await tick(t.db, now);
    const before = t.raw.prepare("SELECT total_changes() n").get()!.n;
    for (let i = 1; i <= 20; i++)
      assert.equal((await tick(t.db, now + i)).state, "idle");
    assert.equal(t.raw.prepare("SELECT total_changes() n").get()!.n, before);
    await changeControl(
      t.db,
      {
        name: "operations",
        paused: true,
        key: "sampling-pause-ops",
        expectedVersion: 0,
        reason: "Check immediate pause",
      },
      "operator",
    );
    assert.equal((await tick(t.db, now + 21)).state, "paused");
    assert.equal(
      (await readiness(t.db, now + 22)).controls.find(
        (c) => c.name === "operations",
      )!.paused,
      true,
    );
  } finally {
    t.close();
  }
});
test("future jobs do not imply a missing runner, while an incomplete control configuration fails closed", async () => {
  const t = testDb(),
    now = Date.now();
  try {
    await enqueue(
      t.db,
      "future-plan",
      "prepare",
      "future-round",
      {},
      now + 3600000,
    );
    const report = await readiness(t.db, now);
    assert.equal(report.status, "idle");
    assert.equal(report.operations.jobs.due, 0);
    assert.equal(report.operations.jobs.queued, 1);
    assert(!report.alerts.some((a) => a.code === "runner-not-observed"));
    t.raw.exec(
      "DROP TRIGGER meme_control_no_delete; DELETE FROM meme_safety_controls WHERE name='collection';",
    );
    await assert.rejects(
      readiness(t.db, now),
      /Safety controls are not configured/,
    );
  } finally {
    t.close();
  }
});
test("stale runner, missed freeze and exhausted collection report explicit local alerts", async () => {
  const t = testDb(),
    now = Date.now();
  try {
    t.raw
      .prepare(
        "INSERT INTO meme_rounds(id,opens_at,closes_at,attribute,state,rules_version) VALUES('missed',?,?,'cast','prepared','local-v1')",
      )
      .run(now - 10000, now + 3600000);
    t.raw
      .prepare(
        "INSERT INTO meme_campaigns VALUES('c',?,'QA',?,?,? ,0,'simulated','Fixture')",
      )
      .run("1".repeat(32), now - 86400000, now + 9 * 86400000, "1000000");
    t.raw
      .prepare(
        "INSERT INTO meme_source_runs(id,campaign_id,wallet,provider,from_at,through_at,state,root_hash,created_at) VALUES('source','c',?,'helius',?,?,'collecting','hash',?)",
      )
      .run("1".repeat(32), now - 86400000, now - 120000, now);
    const token = await beginTick(t.db, now - 200000);
    await finishTick(t.db, token, "idle", now - 199000);
    const report = await readiness(t.db, now);
    for (const code of [
      "runner-stale",
      "ownership-freeze-missing",
      "source-allowance-unavailable",
    ])
      assert(report.alerts.some((a) => a.code === code));
    t.raw.exec(
      "UPDATE meme_source_budgets SET ceiling=10 WHERE provider='helius'",
    );
    assert(
      !(await readiness(t.db, now)).alerts.some(
        (a) => a.code === "source-allowance-unavailable",
      ),
      "Unused zero Pyth allowance must not block a Helius collector",
    );
    await changeControl(
      t.db,
      {
        key: "diagnostic-pause-ops",
        name: "operations",
        paused: true,
        expectedVersion: 0,
        reason: "Intentional fixture pause",
      },
      "operator",
    );
    assert(
      !(await readiness(t.db, now)).alerts.some(
        (a) => a.code === "runner-stale",
      ),
    );
    assert.equal(
      t.raw
        .prepare("SELECT used FROM meme_source_budgets WHERE provider='helius'")
        .get()!.used,
      0,
    );
  } finally {
    t.close();
  }
});

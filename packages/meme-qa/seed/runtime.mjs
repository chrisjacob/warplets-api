/** Dedicated local-only worker thread. Its virtual clock/network fence cannot affect another runtime. */
import { parentPort, workerData } from "node:worker_threads";
import { register } from "../../../meme/node_modules/tsx/dist/esm/api/index.mjs";
import { existsSync } from "node:fs";
import { backup } from "node:sqlite";
register();
const NativeDate = Date;
const clock = { now: workerData.asOf };
globalThis.Date = class extends NativeDate {
  constructor(...args) {
    super(...(args.length ? args : [clock.now]));
  }
  static now() {
    return clock.now;
  }
};
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const u = new URL(input instanceof Request ? input.url : String(input));
  if (u.protocol === "data:" && u.href.length < 8 * 1024 * 1024)
    return nativeFetch(input, init);
  throw Error("Seeded QA is offline; external requests are disabled");
};
const { testDb } = await import("../../../meme/src/worker/testDb.ts");
const {
  seedData,
  profile,
  fid,
  hash,
  receipt,
  publishScores,
  currentScores,
  syncClaimCredits,
  finalizeDemoRounds,
  price,
} = await import("./data.ts");
const { boost } = await import("../../../meme/src/shared/scoring.ts");
const { sha } = await import("../../../meme/src/worker/db.ts");
const { default: worker } = await import("../../../meme/src/worker/index.ts");
const { importTrading, publishTrading } = await import(
  "../../../meme/src/worker/trading.ts"
);
const { appendMarketEvidence, publishMarket } = await import(
  "../../../meme/src/worker/markets.ts"
);
const { createCard, attachCardImage } = await import(
  "../../../meme/src/worker/shares.ts"
);
const { renderCard } = await import("../../../meme/scripts/render-share.mjs");
const { encode58 } = await import("../../../meme/src/shared/base58.ts");
const { adminRead, adminCommand, adminReply, refreshAdminMetrics } =
  await import("../../../meme/src/worker/admin.ts");
const { seedAdmin, simulateAdmin, prepareDemoRounds } = await import(
  "./admin.ts"
);
if (!existsSync(workerData.file)) {
  const build = testDb();
  try {
    await seedData(build, clock.now, workerData.scenario);
    await seedAdmin(build, clock.now);
    await refreshAdminMetrics(build.db, clock.now);
    await backup(build.raw, workerData.file);
  } finally {
    build.close();
  }
}
const t = testDb({ file: workerData.file });
const exists = t.raw
  .prepare("SELECT name FROM sqlite_master WHERE name='qa_meta'")
  .get();
if (!exists) await seedData(t, clock.now, workerData.scenario);
else {
  if (
    t.raw.prepare("SELECT value FROM qa_meta WHERE key='ready'").get()
      ?.value !== "true"
  )
    throw Error("Incomplete QA generation; reset only QA data");
  clock.now = Number(
    t.raw.prepare("SELECT value FROM qa_meta WHERE key='clock'").get().value,
  );
}
const origin = workerData.origin;
const env = {
  MEME_DB: t.db,
  LOCAL_PREVIEW_ONLY: "true",
  LOCAL_PARTICIPATION_ENABLED: "true",
  LOCAL_OPERATIONS_ENABLED: "false",
  HELIUS_API_KEY: "",
  PYTH_API_KEY: "",
  MEME_QA_ORIGIN: "",
  MEME_QA_FIDS: "",
  MEME_QA_GATEWAY_TOKEN: "",
};
async function refreshScores() {
  const r = t.raw
    .prepare(
      "SELECT id FROM meme_rounds WHERE state='open' ORDER BY closes_at DESC LIMIT 1",
    )
    .get();
  if (r)
    await publishScores(t, r.id, currentScores(t, r.id, clock.now), clock.now);
}
async function refreshProjections() {
  for (const row of t.raw
    .prepare("SELECT definition FROM meme_markets")
    .all()) {
    const m = JSON.parse(row.definition),
      index = Number(m.id.split("-").at(-1));
    const last = t.raw
      .prepare(
        "SELECT MAX(at) at FROM meme_market_observations WHERE market_id=?",
      )
      .get(m.id).at;
    if (last < clock.now) {
      const points = [];
      for (let at = last + 7200000; at < clock.now; at += 7200000) {
        const p = price(index, at, m.launchedAt);
        points.push({
          at,
          observedAt: clock.now,
          ogUsd: p.og.toFixed(12),
          attnOg: p.pair.toFixed(12),
          intervalMs: 7200000,
          source: "tenx-ui-seed-v1:synthetic",
          evidenceHash: hash(m.id + at),
        });
      }
      const p = price(index, clock.now, m.launchedAt);
      points.push({
        at: clock.now,
        observedAt: clock.now,
        ogUsd: p.og.toFixed(12),
        attnOg: p.pair.toFixed(12),
        intervalMs: 7200000,
        source: "tenx-ui-seed-v1:synthetic",
        evidenceHash: hash(m.id + clock.now),
      });
      for (let offset = 0; offset < points.length; offset += 20)
        await appendMarketEvidence(
          t.db,
          m.id,
          "qa-tick:" + m.id + ":" + last + ":" + clock.now + ":" + offset,
          points.slice(offset, offset + 20),
          clock.now,
        );
    }
    for (const window of ["24h", "30d", "all"])
      await publishMarket(t.db, m.id, window, clock.now);
  }
  for (const row of t.raw.prepare("SELECT fid,payload FROM qa_trades").all()) {
    const input = JSON.parse(row.payload);
    if (input.throughAt === clock.now) continue;
    input.throughAt = clock.now;
    input.sourceHash = hash(input.sourceHash + ":clock:" + clock.now);
    const parent = t.raw
      .prepare("SELECT source_id FROM meme_trading_source_heads WHERE fid=?")
      .get(row.fid).source_id;
    await importTrading(
      t.db,
      input,
      parent,
      "Synthetic clock advancement coverage",
      clock.now,
    );
    t.raw
      .prepare("UPDATE qa_trades SET payload=? WHERE fid=?")
      .run(JSON.stringify(input), row.fid);
  }
  if (t.raw.prepare("SELECT COUNT(*) n FROM qa_trades").get().n)
    await publishTrading(t.db, clock.now, clock.now);
  await refreshScores();
}

function context(persona = "participant") {
  const index = {
    participant: 0,
    holder: 0,
    trader: 1,
    rewards: 9,
    nonholder: 3,
    guest: -1,
  }[persona];
  if (index === undefined) throw Error("Unknown demo persona");
  return {
    version: 1,
    mode: "simulated",
    scenario: workerData.scenario,
    clock: clock.now,
    paused: true,
    generation: workerData.generation,
    persona,
    person: index < 0 ? null : profile(index),
    people: Array.from({ length: 240 }, (_, i) => profile(i)),
    latestMarket:
      t.raw
        .prepare(
          "SELECT id FROM meme_campaigns ORDER BY launched_at DESC,id LIMIT 1",
        )
        .get()?.id ?? null,
    capabilities: {
      vote: true,
      simulateTrade: true,
      simulateClaim: true,
      previewShare: true,
    },
    productionReady: false,
  };
}
async function actions(path, body, person) {
  if (!person) throw Error("Choose a demo account");
  if (
    !body ||
    typeof body.key !== "string" ||
    !/^[\w:-]{8,100}$/.test(body.key)
  )
    throw Error("Stable QA operation key required");
  const fingerprint = hash(JSON.stringify({ path, body, person: person.fid })),
    old = t.raw.prepare("SELECT * FROM qa_commands WHERE id=?").get(body.key);
  if (old) {
    if (old.hash !== fingerprint) throw Error("QA operation key changed");
    await syncClaimCredits(t, clock.now, person.fid);
    return JSON.parse(old.result);
  }
  let result;
  if (path === "claim" || path === "claim-all") {
    const eligible = t.raw
      .prepare(
        "SELECT a.id,e.amount FROM meme_entitlements e JOIN meme_allocations a ON a.id=e.allocation_id JOIN meme_financial_receipts f ON f.business_key='solana-local:fund:'||a.id WHERE e.fid=? AND (CAST((a.release_at+999)/1000 AS INTEGER)*1000+1000)<=? AND NOT EXISTS(SELECT 1 FROM meme_financial_receipts cl WHERE cl.business_key='solana-local:claim:'||a.id||':'||e.fid) ORDER BY a.release_at,a.id LIMIT 500",
      )
      .all(person.fid, clock.now);
    if (!eligible.length)
      throw Error("No funded released unclaimed demo rewards");
    const selected =
      path === "claim"
        ? eligible.filter((a) => a.id === body.allocationId)
        : eligible;
    if (!selected.length) throw Error("Allocation is not eligible");
    result = {
      mode: "simulated",
      claimed: selected.length,
      remaining: eligible.length - selected.length,
    };
    t.raw.exec("BEGIN IMMEDIATE");
    try {
      for (const a of selected)
        receipt(t, "claim", a.id + ":" + person.fid, clock.now);
      t.raw
        .prepare("INSERT INTO qa_commands VALUES(?,?,?)")
        .run(body.key, fingerprint, JSON.stringify(result));
      t.raw.exec("COMMIT");
    } catch (error) {
      if (t.raw.isTransaction) t.raw.exec("ROLLBACK");
      throw error;
    }
    await syncClaimCredits(t, clock.now, person.fid);
    await refreshScores();
    return result;
  } else if (path === "trade") {
    if (
      !["buy", "sell"].includes(body.side) ||
      !Number.isSafeInteger(body.quantity) ||
      body.quantity < 1 ||
      body.quantity > 1000000
    )
      throw Error("Choose 1–1,000,000 whole demo tokens");
    await syncClaimCredits(t, clock.now, person.fid);
    const row = t.raw
        .prepare("SELECT payload FROM qa_trades WHERE fid=?")
        .get(person.fid),
      input = JSON.parse(row.payload),
      m = t.raw
        .prepare("SELECT definition FROM meme_markets WHERE id=?")
        .get(body.marketId);
    if (!m) throw Error("Unknown demo edition");
    const prior = input.events.find(
      (e) => e.id === "qa-interaction:" + body.key,
    );
    if (prior) {
      if (
        prior.kind !== body.side ||
        prior.marketId !== body.marketId ||
        prior.quantity !== String(body.quantity)
      )
        throw Error("QA trade identity changed");
      await publishTrading(t.db, clock.now, clock.now);
      const restored = {
        mode: "simulated",
        side: body.side,
        quantity: body.quantity,
      };
      t.raw
        .prepare("INSERT INTO qa_commands VALUES(?,?,?)")
        .run(body.key, fingerprint, JSON.stringify(restored));
      return restored;
    }
    const market = JSON.parse(m.definition),
      index = Number(market.id.split("-").at(-1)),
      p = price(index, clock.now, market.launchedAt),
      usd = body.quantity * p.attn;
    input.throughAt = clock.now;
    input.sourceHash = hash(input.sourceHash + body.key);
    input.events.push({
      id: "qa-interaction:" + body.key,
      at: clock.now,
      slot: Math.floor(clock.now / 1000),
      index: input.events.length,
      wallet: person.wallet,
      marketId: market.id,
      kind: body.side,
      quantity: String(body.quantity),
      usd: usd.toFixed(8),
      og: (usd / p.og).toFixed(8),
      feeUsd: (usd * 0.003 + 0.01).toFixed(8),
      feeOg: ((usd * 0.003 + 0.01) / p.og).toFixed(8),
      signature: encode58(
        new Uint8Array(
          Buffer.from(hash(body.key) + hash("signature:" + body.key), "hex"),
        ),
      ),
      evidenceHash: hash("evidence:" + body.key),
      finalized: true,
    });
    const parent = t.raw
      .prepare("SELECT source_id FROM meme_trading_source_heads WHERE fid=?")
      .get(person.fid).source_id;
    await importTrading(
      t.db,
      input,
      parent,
      "Explicit local simulated trade",
      clock.now,
    );
    t.raw
      .prepare("UPDATE qa_trades SET payload=? WHERE fid=?")
      .run(JSON.stringify(input), person.fid);
    await publishTrading(t.db, clock.now, clock.now);
    result = { mode: "simulated", side: body.side, quantity: body.quantity };
  } else throw Error("Unknown simulated action");
  t.raw
    .prepare("INSERT INTO qa_commands VALUES(?,?,?)")
    .run(body.key, fingerprint, JSON.stringify(result));
  return result;
}
async function handle(message) {
  const c = context(message.persona),
    url = new URL(message.path, origin),
    path = url.pathname;
  url.searchParams.delete("persona");
  if (
    (path === "/clock" || path.startsWith("/actions/")) &&
    message.method !== "POST"
  )
    return Response.json(
      { error: "Use POST for QA mutations" },
      { status: 405 },
    );
  if (["/context", "/claimable"].includes(path) && message.method !== "GET")
    return Response.json({ error: "Read-only QA route" }, { status: 405 });
  if (path.startsWith("/admin/")) {
    const part = path.slice(7),
      actor = { id: "qa-demo-admin", scopes: ["*"] },
      options = {
        environment: "local",
        publicOrigin: "https://qa.invalid",
        simulation: (action, payload, id) =>
          simulateAdmin(t, action, payload, id, clock.now),
      };
    const reply = await adminReply(async () => {
      if (part === "commands" && message.method === "POST") {
        const result = await adminCommand(t.db, message.body, actor, options);
        if (["round.publish", "control.set"].includes(message.body.action))
          await prepareDemoRounds(t, clock.now);
        if (["round.outcome", "launch.handoff"].includes(message.body.action))
          await refreshAdminMetrics(t.db, clock.now);
        return result;
      }
      if (message.method === "GET")
        return adminRead(
          t.db,
          {
            section: part,
            date: url.searchParams.get("date") ?? undefined,
            range: url.searchParams.get("range") ?? undefined,
          },
          actor,
          options,
        );
      throw Error("Method not allowed");
    });
    return Response.json(reply.ok ? reply.data : { error: reply.error }, {
      status: reply.ok ? 200 : reply.status,
    });
  }
  if (path === "/context") return Response.json(c);
  if (path === "/clock") {
    const step = message.body?.step;
    if (!["hour", "day", "boundary"].includes(step))
      throw Error("Unknown clock step");
    const saved = t.raw
        .prepare("SELECT value FROM qa_meta WHERE key='clock_operation'")
        .get(),
      operation = saved ? JSON.parse(saved.value) : null;
    const resume =
      operation?.state === "pending" &&
      [operation.from, operation.to].includes(message.body?.expectedClock) &&
      operation.step === step &&
      operation.to === clock.now;
    if (operation?.state === "pending" && !resume)
      throw Error(
        "Incomplete " + operation.step + " clock step; retry that step",
      );
    if (message.body?.expectedClock !== clock.now && !resume)
      throw Error(
        "Demo clock changed; reload or retry the same incomplete step",
      );
    const next = t.raw
      .prepare(
        "SELECT MIN(at) at FROM (SELECT closes_at at FROM meme_rounds UNION ALL SELECT (CAST((release_at+999)/1000 AS INTEGER)*1000+1000) at FROM meme_allocations) WHERE at>?",
      )
      .get(clock.now).at;
    const target = resume
      ? operation.to
      : step === "day"
        ? clock.now + 86400000
        : step === "hour"
          ? clock.now + 3600000
          : (next ?? clock.now + 86400000) + 1;
    if (target > workerData.asOf + 10 * 86400000)
      throw Error("Demo horizon is ten days; reset QA to start again");
    const intent = resume
      ? operation
      : { from: clock.now, to: target, step, state: "pending" };
    t.raw.exec("BEGIN IMMEDIATE");
    try {
      t.raw
        .prepare(
          "INSERT INTO qa_meta VALUES('clock_operation',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(JSON.stringify(intent));
      t.raw
        .prepare("UPDATE qa_meta SET value=? WHERE key='clock'")
        .run(String(target));
      t.raw.exec("COMMIT");
    } catch (error) {
      t.raw.exec("ROLLBACK");
      throw error;
    }
    clock.now = target;
    t.raw
      .prepare(
        "UPDATE meme_rounds SET state=CASE WHEN closes_at<=? THEN 'closed' ELSE 'open' END WHERE state IN('open','frozen') AND opens_at<=?",
      )
      .run(clock.now, clock.now);
    await refreshProjections();
    finalizeDemoRounds(t, clock.now);
    await refreshAdminMetrics(t.db, clock.now);
    t.raw
      .prepare("UPDATE qa_meta SET value=? WHERE key='clock_operation'")
      .run(JSON.stringify({ ...intent, state: "done" }));
    return Response.json(context(message.persona));
  }
  if (path.startsWith("/actions/"))
    return Response.json(await actions(path.slice(9), message.body, c.person));
  if (path === "/claimable") {
    if (!c.person) return Response.json({ items: [] });
    return Response.json({
      items: t.raw
        .prepare(
          "SELECT a.id allocationId,c.symbol,e.amount,a.release_at releaseAt,EXISTS(SELECT 1 FROM meme_financial_receipts f WHERE f.business_key='solana-local:fund:'||a.id) funded,EXISTS(SELECT 1 FROM meme_financial_receipts cl WHERE cl.business_key='solana-local:claim:'||a.id||':'||e.fid) claimed FROM meme_entitlements e JOIN meme_allocations a ON a.id=e.allocation_id JOIN meme_campaigns c ON c.id=a.campaign_id WHERE e.fid=? ORDER BY a.release_at DESC LIMIT 500",
        )
        .all(c.person.fid),
    });
  }
  if (
    !path.startsWith("/api/meme/") ||
    path.startsWith("/api/meme/operator/") ||
    (message.method !== "GET" &&
      !/^\/api\/meme\/rounds\/[^/]+\/vote$/.test(path) &&
      path !== "/api/meme/notifications")
  )
    throw Error("Seed gateway route not allowed");
  const sessionToken = hash(
    "local-session:" + message.session + ":" + message.persona,
  );
  t.raw
    .prepare(
      "INSERT INTO meme_sessions VALUES(?,?,?,?,?) ON CONFLICT(token_hash) DO UPDATE SET expires_at=excluded.expires_at",
    )
    .run(
      await sha(sessionToken),
      origin,
      c.person?.fid ?? null,
      c.person?.base ?? null,
      clock.now + 8640000000,
    );
  const headers = {
    "content-type": "application/json",
    origin,
    cookie: "meme_session=" + sessionToken,
  };
  const internal = new Request(url, {
    method: message.method,
    headers,
    ...(message.method === "POST"
      ? { body: JSON.stringify(message.body) }
      : {}),
  });
  if (path === "/api/meme/shares") {
    const u = new URL(internal.url);
    const card = await createCard(
      t.db,
      u.searchParams.get("kind"),
      u.searchParams.get("subject"),
      u.searchParams.get("window") ?? "24h",
      Number(u.searchParams.get("fid")) || null,
      clock.now,
    );
    const exists = t.raw
      .prepare("SELECT COUNT(*) n FROM meme_share_images WHERE card_id=?")
      .get(card.id).n;
    if (exists < 2)
      for (const [format, height] of [
        ["mini", 800],
        ["og", 630],
      ])
        await attachCardImage(
          t.db,
          card.id,
          format,
          (await renderCard(card, height)).toString("base64"),
        );
  }
  const response = await worker.fetch(internal, env);
  if (path === "/api/meme/history" && response.ok) {
    const data = await response.json();
    for (const row of data.items) {
      const edition = t.raw
        .prepare(
          "SELECT c.id,c.symbol,c.mint FROM qa_editions q JOIN meme_campaigns c ON c.id=q.campaign_id WHERE q.round_id=?",
        )
        .get(row.id);
      if (edition) row.edition = edition;
    }
    return Response.json(data);
  }
  if (message.method === "POST" && response.ok) await refreshScores();
  return response;
}
parentPort.postMessage({ ready: true, context: context() });
let queue = Promise.resolve();
parentPort.on("message", (message) => {
  queue = queue.then(async () => {
    try {
      const response = await handle(message),
        bytes = new Uint8Array(await response.arrayBuffer());
      parentPort.postMessage({
        id: message.id,
        status: response.status,
        headers: [...response.headers].filter(([k]) => k !== "set-cookie"),
        bytes,
      });
    } catch (e) {
      parentPort.postMessage({
        id: message.id,
        status: 409,
        headers: [["content-type", "application/json"]],
        bytes: new TextEncoder().encode(JSON.stringify({ error: e.message })),
      });
    }
  });
});

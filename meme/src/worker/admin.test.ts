import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./testDb";
import { adminRead, adminCommand } from "./admin";
import { sealCycle } from "./cycles";
import { encode58 } from "../shared/base58";
import { commsCommand } from "./adminComms";
import { refreshTrending } from "./gmgn";
const actor = {
    id: "round-operator",
    scopes: ["meme:read", "meme:rounds", "meme:comms", "meme:ops"],
  },
  options = { environment: "local" as const };
const candidates = Array.from({ length: 3 }, (_, i) => ({
  name: "OG " + i,
  symbol: "OG" + i,
  ogMint: encode58(new Uint8Array(32).fill(i + 1)),
  origin: "manual" as const,
  reviewed: true,
}));
test('concurrent intent IDs cannot substitute payloads or execute twice',async()=>{
 const t=testDb();try{const day=new Date(Date.now()+4*86400000).toISOString().slice(0,10),base={id:'concurrent-intent',action:'draft.save' as const,expectedVersion:0,reason:'Reviewed concurrently',payload:{day,candidates}};
 const other={...base,payload:{day,candidates:[]}},results=await Promise.allSettled([adminCommand(t.db,base,actor,options),adminCommand(t.db,other,actor,options)]),winner=results[0].status==='fulfilled'?base:other;
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const saved=t.raw.prepare('SELECT candidates,version FROM meme_admin_drafts').get()!;assert.equal(JSON.parse(String(saved.candidates)).length,winner.payload.candidates.length);assert.equal(saved.version,1);
 const again=await Promise.allSettled([adminCommand(t.db,winner,actor,options),adminCommand(t.db,winner,actor,options)]);assert.ok(again.every(r=>r.status==='fulfilled'));assert.equal(t.raw.prepare('SELECT version FROM meme_admin_drafts').get()!.version,1);
 }finally{t.close();}
});
test('invalid operator input fails clearly without leaving the global journal fenced',async()=>{
 const t=testDb();try{await assert.rejects(adminCommand(t.db,{id:'bad-date',action:'draft.save',expectedVersion:0,reason:'Input validation',payload:{day:'2026-02-31',candidates}},actor,options),/valid UTC/);assert.equal(t.raw.prepare("SELECT COUNT(*) n FROM meme_admin_commands WHERE state='pending'").get()!.n,0);await adminCommand(t.db,{id:'next-valid',action:'draft.save',expectedVersion:1,reason:'Corrected input',payload:{day:new Date(Date.now()+4*86400000).toISOString().slice(0,10),candidates}},actor,options);}finally{t.close();}
});
test("admin commands enforce capabilities, optimistic concurrency, immutable publishing and same-intent replay", async () => {
  const t = testDb();
  try {
    const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    await sealCycle(t.db, "cycle-admin", date);
    const save = {
      id: "save-a",
      action: "draft.save" as const,
      expectedVersion: 0,
      reason: "Reviewed shortlist",
      payload: { day: date, candidates },
    };
    await assert.rejects(
      adminCommand(
        t.db,
        save,
        { id: "reader", scopes: ["meme:read"] },
        options,
      ),
      /capability/,
    );
    await adminCommand(t.db, save, actor, options);
    assert.equal(
      (await adminCommand(t.db, save, actor, options)).replayed,
      true,
    );
    await assert.rejects(
      adminCommand(
        t.db,
        { ...save, payload: { day: date, candidates: [] } },
        actor,
        options,
      ),
      /another intent/,
    );
    await assert.rejects(
      adminCommand(t.db, { ...save, id: "stale" }, actor, options),
      /state changed/,
    );
    const publish = {
      id: "publish-a",
      action: "round.publish" as const,
      expectedVersion: 1,
      reason: "Publish three reviewed tokens",
      payload: { day: date, cycleId: "cycle-admin" },
    };
    await adminCommand(t.db, publish, actor, options);
    assert.equal(t.raw.prepare("SELECT COUNT(*) n FROM meme_jobs").get()!.n, 1);
    await adminCommand(t.db, publish, actor, options);
    assert.equal(t.raw.prepare("SELECT COUNT(*) n FROM meme_jobs").get()!.n, 1);
    await assert.rejects(
      adminCommand(
        t.db,
        { ...save, id: "edit-published", expectedVersion: 2 },
        actor,
        options,
      ),
      /immutable/,
    );
    await assert.rejects(
      adminRead(
        t.db,
        { section: "health" },
        { id: "round-only", scopes: ["meme:rounds"] },
        options,
      ),
      /capability/,
    );
    assert.equal(
      (await adminRead(t.db, { section: "overview", date }, actor, options))
        .financialActions.launching,
      false,
    );
  } finally {
    t.close();
  }
});
test("lost admin reservation and draft receipts reconcile with the original identity", async () => {
  const t = testDb();
  try {
    const date = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10),
      command = {
        id: "lost-save",
        action: "draft.save" as const,
        expectedVersion: 0,
        reason: "Reviewed tokens",
        payload: { day: date, candidates },
      };
    t.interruptNextBatch();
    await assert.rejects(
      adminCommand(t.db, command, actor, options),
      /lost response/,
    );
    await adminCommand(t.db, command, actor, options);
    assert.equal(
      t.raw.prepare("SELECT version FROM meme_admin_drafts").get()!.version,
      1,
    );
    assert.equal(
      t.raw.prepare("SELECT version FROM meme_admin_state").get()!.version,
      1,
    );
  } finally {
    t.close();
  }
});
test("social drafts require current approval, pause clearance and an approved origin; edits invalidate approval", async () => {
  const t = testDb();
  try {
    const call = (action: string, p: Record<string, unknown>, id: string) =>
      commsCommand(
        t.db,
        action,
        p,
        "comms",
        id,
        Date.now(),
        "https://launchpad.example",
      );
    const draft = (await call(
      "social.save",
      { title: "Vote", body: "Choose today’s OG.", targetPath: "/?view=Today" },
      "create",
    )) as { id: string };
    await assert.rejects(
      call("social.open", { id: draft.id, draftVersion: 1 }, "early"),
      /Approve/,
    );
    await call("social.approve", { id: draft.id, draftVersion: 1 }, "approve");
    await assert.rejects(
      call("social.open", { id: draft.id, draftVersion: 1 }, "paused"),
      /paused/,
    );
    await call(
      "social.save",
      {
        id: draft.id,
        draftVersion: 1,
        title: "Vote",
        body: "Edited post.",
        targetPath: "/",
      },
      "edit",
    );
    await assert.rejects(
      call("social.open", { id: draft.id, draftVersion: 2 }, "unapproved"),
      /Approve/,
    );
    await call(
      "social.approve",
      { id: draft.id, draftVersion: 2 },
      "approve-2",
    );
    await call("comms.pause", { channel: "social", paused: false }, "resume");
    const opened = (await call(
      "social.open",
      { id: draft.id, draftVersion: 2 },
      "open",
    )) as { composerUrl: string; posted: boolean };
    assert.equal(new URL(opened.composerUrl).hostname, "farcaster.xyz");
    assert.equal(opened.posted, false);
    await assert.rejects(
      call(
        "social.save",
        { title: "Bad", body: "Bad", targetPath: "//evil.example" },
        "bad",
      ),
      /relative/,
    );
  } finally {
    t.close();
  }
});
test("GMGN uses the official read route, retains provider order/cache and consumes failed attempts without resets", async () => {
  const t = testDb();
  let calls = 0;
  const request = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(
      url.origin + url.pathname,
      "https://openapi.gmgn.ai/v1/market/rank",
    );
    assert.equal(url.searchParams.get("order_by"), "default");
    assert.deepEqual(url.searchParams.getAll("filters"), [
      "renounced",
      "frozen",
    ]);
    assert.equal(new Headers(init?.headers).get("X-APIKEY"), "test-key");
    return Response.json({
      code: 0,
      data: {
        rank: candidates.map((c, i) => ({
          address: c.ogMint,
          name: c.name,
          symbol: c.symbol,
          rank: 99 - i,
          volume: "123",
          price_change_percent: "-2",
        })),
      },
    });
  }) as typeof fetch;
  try {
    await assert.rejects(
      refreshTrending(t.db, "1h", undefined, "no-key", request),
      /not configured/,
    );
    await assert.rejects(
      refreshTrending(t.db, "1h", "test-key", "no-budget", request),
      /allowance/,
    );
    assert.equal(calls, 0);
    t.raw.exec("UPDATE meme_gmgn_allowance SET ceiling=2");
    const result = await refreshTrending(
      t.db,
      "1h",
      "test-key",
      "first",
      request,
    );
    assert.equal(result.items[0].ogMint, candidates[0].ogMint);
    assert.equal(calls, 1);
    await refreshTrending(t.db, "1h", "test-key", "first", request);
    assert.equal(calls, 1);
    await assert.rejects(
      refreshTrending(t.db, "1h", "test-key", "fresh", request),
      /fresh/,
    );
    assert.equal(calls, 1);
    await assert.rejects(
      refreshTrending(
        t.db,
        "24h",
        "test-key",
        "failed",
        async () => new Response("", { status: 429 }),
        Date.now() + 900001,
      ),
      /unavailable/,
    );
    assert.equal(
      t.raw.prepare("SELECT used FROM meme_gmgn_allowance").get()!.used,
      2,
    );
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_gmgn_snapshots").get()!.n,
      1,
    );
  } finally {
    t.close();
  }
});

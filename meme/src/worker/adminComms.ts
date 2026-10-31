import {
  one,
  run,
  rows,
  text,
  integer,
  requireThat,
  sha,
  Problem,
  type Database,
} from "./db";
import { canonical } from "../shared/canonical";
import { Exact } from "../shared/exact";
function parseThreshold(value:unknown){try{return Exact.decimal(text(value,'threshold',50));}catch{throw new Problem(400,'Use a decimal USD threshold');}}
import { enqueueNotification, type NotificationConfig } from "./notifications";
import { enqueueBaseNotice, type BaseNoticeConfig } from "./baseNotifications";
function destination(value: unknown) {
  const path = text(value, "destination", 500);
  requireThat(
    /^\/(?!\/)[A-Za-z0-9/?=&%:._~-]*$/.test(path) &&
      !/%(?:2f|5c|0[ad])/i.test(path),
    400,
    "Use a launchpad-relative destination",
  );
  return path;
}
export async function commsCommand(
  db: Database,
  action: string,
  p: Record<string, unknown>,
  actor: string,
  commandId: string,
  at: number,
  origin?: string,
) {
  if (action === "comms.refresh") return collectNoticeCandidates(db, at);
  if (action === "comms.pause") {
    requireThat(
      typeof p.paused === "boolean" &&
        ["social", "notifications"].includes(String(p.channel)),
      400,
      "Choose a channel and pause state",
    );
    if (p.channel === "social")
      await run(
        db,
        "UPDATE meme_comms_controls SET social_paused=? WHERE id=1",
        p.paused ? 1 : 0,
      );
    else
      await run(
        db,
        "UPDATE meme_notification_control SET paused=? WHERE id=1",
        p.paused ? 1 : 0,
      );
    return { channel: p.channel, paused: p.paused };
  }
  if (action === "milestone.save") {
    const edition = text(p.editionId, "edition", 100),
      threshold = parseThreshold(p.thresholdUsd);
    requireThat(
      threshold.n > 0n &&
        threshold.compare(Exact.decimal("1000000000000000")) <= 0 &&
        typeof p.enabled === "boolean",
      400,
      "Positive bounded threshold and enabled state required",
    );
    requireThat(
      await one(db, "SELECT id FROM meme_campaigns WHERE id=?", edition),
      404,
      "Edition not found",
    );
    const amount = threshold.decimal(8);
    requireThat(
      Exact.decimal(amount).compare(threshold) === 0,
      400,
      "Use at most eight decimal places",
    );
    const id = "rule:" + (await sha(canonical({ edition, threshold: amount }))),
      old = await one<{ version: number; last_command_id: string }>(
        db,
        "SELECT version,last_command_id FROM meme_milestone_rules WHERE id=?",
        id,
      ),
      version = integer(p.ruleVersion, "rule version", 0);
    // Same command replay retains the committed rule/version. Threshold identity is permanent.
    if (old?.last_command_id === commandId) return { id, version: old.version };
    requireThat(
      (old?.version ?? 0) === version,
      409,
      "Milestone rule changed; refresh",
    );
    await run(
      db,
      "INSERT INTO meme_milestone_rules VALUES(?,?,?,?,1,?,?,?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,version=version+1,updated_at=excluded.updated_at,last_command_id=excluded.last_command_id WHERE version=?",
      id,
      edition,
      amount,
      p.enabled ? 1 : 0,
      at,
      at,
      commandId,
      version,
    );
    return { id, version: version + 1 };
  }
  if (action === "social.save") {
    const id =
        typeof p.id === "string"
          ? text(p.id, "draft ID", 100)
          : "social:" + (await sha(commandId)),
      title = text(p.title, "title", 80),
      body = text(p.body, "post", 500),
      path = destination(p.targetPath);
    const old = await one<{
      version: number;
      last_command_id: string;
      state: string;
    }>(
      db,
      "SELECT version,last_command_id,state FROM meme_social_drafts WHERE id=?",
      id,
    );
    if (old?.last_command_id === commandId) return { id, version: old.version };
    requireThat(
      !old || old.version === integer(p.draftVersion, "draft version", 1),
      409,
      "Draft changed; refresh",
    );
    requireThat(
      !old || ["draft", "approved"].includes(old.state),
      409,
      "A composer was already opened; create a new draft",
    );
    await run(
      db,
      "INSERT INTO meme_social_drafts(id,version,title,body,target_path,state,created_at,updated_at,last_command_id) VALUES(?,1,?,?,?,'draft',?,?,?) ON CONFLICT(id) DO UPDATE SET version=version+1,title=excluded.title,body=excluded.body,target_path=excluded.target_path,state='draft',approved_by=NULL,updated_at=excluded.updated_at,last_command_id=excluded.last_command_id",
      id,
      title,
      body,
      path,
      at,
      at,
      commandId,
    );
    return { id, version: (old?.version ?? 0) + 1 };
  }
  if (action === "social.approve" || action === "social.open") {
    const id = text(p.id, "draft ID", 100),
      version = integer(p.draftVersion, "draft version", 1),
      draft = await one<{
        version: number;
        state: string;
        body: string;
        target_path: string;
        last_command_id: string;
      }>(db, "SELECT * FROM meme_social_drafts WHERE id=?", id);
    requireThat(
      draft && draft.version === version,
      409,
      "Review the current draft version",
    );
    if (action === "social.approve") {
      requireThat(
        ["draft", "approved"].includes(draft.state),
        409,
        "Composer is already opened",
      );
      await run(
        db,
        "UPDATE meme_social_drafts SET state='approved',approved_by=?,updated_at=?,last_command_id=? WHERE id=? AND version=?",
        actor,
        at,
        commandId,
        id,
        version,
      );
      return { id, version, approved: true };
    }
    requireThat(
      draft.state === "approved" ||
        (draft.state === "composer_opened" &&
          draft.last_command_id === commandId),
      409,
      "Approve this exact draft before opening a composer",
    );
    requireThat(
      (
        await one<{ social_paused: number }>(
          db,
          "SELECT social_paused FROM meme_comms_controls WHERE id=1",
        )
      )?.social_paused === 0,
      409,
      "Social posting is paused",
    );
    requireThat(
      origin,
      409,
      "Canonical public launchpad origin is not configured",
    );
    const url = new URL(origin);
    requireThat(
      url.protocol === "https:" &&
        url.origin === origin &&
        !url.username &&
        !url.password,
      409,
      "Approved HTTPS origin required",
    );
    const composer = new URL("https://farcaster.xyz/~/compose");
    composer.searchParams.set("text", draft.body);
    composer.searchParams.append("embeds[]", origin + draft.target_path);
    await run(
      db,
      "UPDATE meme_social_drafts SET state='composer_opened',updated_at=?,last_command_id=? WHERE id=? AND version=?",
      at,
      commandId,
      id,
      version,
    );
    return { id, version, composerUrl: composer.href, posted: false };
  }
  throw new Problem(400, "Unknown communications command");
}
export const NOTICE_PRIORITY = {
  rewards: 40,
  launch: 30,
  voting: 20,
  milestones: 10,
} as const;
/** Bounded preparation of verified event previews. This never sends or initiates collection. */
export async function collectNoticeCandidates(db: Database, now = Date.now()) {
  const events = [
    ...(await rows<{
      subject: string;
      kind: keyof typeof NOTICE_PRIORITY;
      expires: number;
    }>(
      db,
      "SELECT r.id subject,'voting' kind,r.closes_at expires FROM meme_rounds r JOIN meme_ownership_snapshots s ON s.id=r.snapshot_id AND s.state='ready' WHERE r.state='open' AND r.opens_at<=? AND r.closes_at>? ORDER BY r.closes_at LIMIT 10",
      now,
      now,
    )),
    ...(await rows<{
      subject: string;
      kind: keyof typeof NOTICE_PRIORITY;
      expires: number;
    }>(
      db,
      "SELECT c.id subject,'launch' kind,c.launched_at+86400000 expires FROM meme_campaigns c JOIN meme_financial_receipts f ON f.subject=c.id AND f.operation='launch' WHERE c.launched_at<=? AND c.launched_at>? ORDER BY c.launched_at DESC LIMIT 20",
      now,
      now - 86400000,
    )),
    ...(await rows<{
      subject: string;
      kind: keyof typeof NOTICE_PRIORITY;
      expires: number;
    }>(
      db,
      "SELECT a.id subject,'rewards' kind,a.release_at+86400000 expires FROM meme_allocations a JOIN meme_financial_receipts f ON f.subject=a.id AND f.operation='fund' JOIN meme_settlements s ON s.round_id=a.round_id AND s.state='finalized' WHERE a.release_at+1000<=? AND a.release_at>? AND f.confirmed_at<=? ORDER BY a.release_at DESC LIMIT 100",
      now,
      now - 86400000,
      now,
    )),
  ];
  for (const event of events) {
    const key = event.kind + ":" + (await sha(event.subject));
    await run(
      db,
      "INSERT OR IGNORE INTO meme_admin_notice_candidates VALUES(?,?,?,?,?,?,'pending',NULL)",
      "notice:" + key,
      event.kind,
      event.subject,
      NOTICE_PRIORITY[event.kind],
      now,
      event.expires,
    );
    const title =
        event.kind === "voting"
          ? "Voting is open"
          : event.kind === "launch"
            ? "Launch confirmed"
            : "Rewards released",
      body =
        event.kind === "voting"
          ? "Today’s shortlist is ready. Vote for your OG."
          : event.kind === "launch"
            ? "A new daily ATTN edition has launched. Follow its performance."
            : "A funded daily reward allocation has released. Check your rewards.";
    await run(
      db,
      "INSERT OR IGNORE INTO meme_social_drafts(id,version,title,body,target_path,state,source_event,created_at,updated_at) VALUES(?,1,?,?,?,'draft',?,?,?)",
      "event-social:" + key,
      title,
      body,
      event.kind === "rewards"
        ? "/?view=Rewards"
        : event.kind === "launch"
          ? "/?view=History"
          : "/",
      key,
      now,
      now,
    );
  }
  await run(
    db,
    "UPDATE meme_admin_notice_candidates SET state='suppressed',reason='Expired before processing' WHERE expires_at<=? AND state IN('pending','queued')",
    now,
  );
  return { prepared: events.length, asOf: now, delivery: false };
}
/** Delivery adapters remain fake-only. Caller supplies a bounded subscribed cohort; no collection on reads. */
export async function queuePrioritizedNotices(
  db: Database,
  fids: readonly number[],
  config: NotificationConfig,
  base?: BaseNoticeConfig,
  now = Date.now(),
) {
  requireThat(
    fids.length <= 100 && new Set(fids).size === fids.length,
    400,
    "Use a bounded unique recipient page",
  );
  if (
    (
      await one<{ paused: number }>(
        db,
        "SELECT paused FROM meme_notification_control WHERE id=1",
      )
    )?.paused
  )
    return { paused: true, queued: 0 };
  const events = await rows<{
    id: string;
    kind: keyof typeof NOTICE_PRIORITY;
    subject: string;
  }>(
    db,
    "SELECT id,kind,subject FROM meme_admin_notice_candidates WHERE state IN('pending','queued') AND created_at<=? AND expires_at>? ORDER BY priority DESC,created_at,id LIMIT 50",
    now,
    now,
  );
  let queued = 0;
  for (const event of events)
    for (const fid of fids) {
      try {
        const result = await enqueueNotification(
          db,
          config,
          event.kind,
          event.subject,
          fid,
          now,
        );
        queued += result.queued;
        if (base) {
          const wallets = await rows<{ address: string }>(
            db,
            "SELECT address FROM meme_wallet_links WHERE fid=? AND chain='base' AND revoked_at IS NULL LIMIT 10",
            fid,
          );
          for (const w of wallets)
            queued += (
              await enqueueBaseNotice(
                db,
                base,
                event.kind,
                event.subject,
                fid,
                w.address,
                now,
              )
            ).queued
              ? 1
              : 0;
        }
      } catch (error) {
        if (!(error instanceof Problem))
          throw error; /* Unfunded/non-recipient rewards cannot consume a slot. */
      }
    }
  return { queued, events: events.length, recipients: fids.length };
}

import {
  one,
  rows,
  run,
  json,
  payload,
  requireThat,
  text,
  integer,
  random,
  type Database,
  Problem,
} from "./db";
import { advance, createRound, operator } from "./rounds";
import { settle } from "./settlement";
import { startSnapshot, stepSnapshot } from "./snapshots";
import { canonical } from "../shared/canonical";

type Kind = "score" | "settle" | "prepare";
interface Job {
  id: string;
  kind: Kind;
  subject: string;
  payload: string;
  attempts: number;
  lease_token: string;
  lease_until: number;
}
export async function enqueue(
  db: Database,
  id: string,
  kind: Kind,
  subject: string,
  body: unknown,
  dueAt: number,
  now = Date.now(),
) {
  const bytes = canonical(body);
  await run(
    db,
    "INSERT INTO meme_jobs(id,kind,subject,payload,due_at,state,created_at) VALUES(?,?,?,?,?,'queued',?) ON CONFLICT(id) DO NOTHING",
    id,
    kind,
    subject,
    bytes,
    dueAt,
    now,
  );
  const old = await one<{
    kind: string;
    subject: string;
    payload: string;
    due_at: number;
  }>(db, "SELECT kind,subject,payload,due_at FROM meme_jobs WHERE id=?", id);
  requireThat(
    old?.kind === kind &&
      old.subject === subject &&
      old.payload === bytes &&
      old.due_at === dueAt,
    409,
    "Job identity cannot be reused with another payload",
  );
}
export async function claimJob(db: Database, now = Date.now()) {
  return one<Job>(
    db,
    `UPDATE meme_jobs SET state='running',lease_token=?,lease_until=?,attempts=attempts+1 WHERE id=(SELECT id FROM meme_jobs WHERE due_at<=? AND retry_at<=? AND (state='queued' OR (state='running' AND lease_until<=?)) ORDER BY due_at,id LIMIT 1) RETURNING *`,
    random(),
    now + 60000,
    now,
    now,
    now,
  );
}
/** Only bounded, idempotent non-financial work. A stale runner cannot finish another lease. */
export async function runJob(db: Database, job: Job, now = Date.now()) {
  if (
    !(await one(
      db,
      "SELECT id FROM meme_jobs WHERE id=? AND state='running' AND lease_token=? AND lease_until>?",
      job.id,
      job.lease_token,
      now,
    ))
  )
    return { state: "stale" };
  try {
    let done = false;
    if (job.kind === "score") {
      const p = JSON.parse(job.payload) as { asOf: number };
      await startSnapshot(db, job.id, job.subject, p.asOf);
      done = (await stepSnapshot(db, job.id)).state === "ready";
    } else if (job.kind === "settle") {
      done =
        (await settle(db, job.subject, "scheduled operator"))?.state ===
        "finalized";
    } else {
      const p = JSON.parse(job.payload) as Record<string, unknown>;
      const existing = await one(
        db,
        "SELECT id FROM meme_rounds WHERE id=?",
        job.subject,
      );
      if (!existing) await createRound(db, p, "scheduled operator plan");
      done = true;
    }
    await run(
      db,
      "UPDATE meme_jobs SET state=?,lease_token=NULL,lease_until=NULL,completed_at=?,last_error=NULL,retry_at=0 WHERE id=? AND lease_token=?",
      done ? "done" : "queued",
      done ? now : null,
      job.id,
      job.lease_token,
    );
    return { state: done ? "done" : "queued", id: job.id };
  } catch (error) {
    // Never persist raw provider errors, request URLs, access tokens, or private payloads.
    const message =
      error instanceof Problem
        ? error.message
        : "Job interrupted; retry from persisted checkpoint";
    const blocked =
      error instanceof Problem && [400, 403, 404, 409].includes(error.status);
    await run(
      db,
      "UPDATE meme_jobs SET state=?,lease_token=NULL,lease_until=NULL,last_error=?,retry_at=? WHERE id=? AND lease_token=?",
      blocked ? "blocked" : "queued",
      message.slice(0, 240),
      now + Math.min(300000, 1000 * 2 ** Math.min(job.attempts, 8)),
      job.id,
      job.lease_token,
    );
    return { state: blocked ? "blocked" : "retry", id: job.id, error: message };
  }
}
export async function tick(db: Database, now = Date.now()) {
  await advance(db, now);
  const active = await rows<{ id: string; closes_at: number }>(
    db,
    "SELECT r.id,r.closes_at FROM meme_rounds r JOIN meme_ownership_snapshots o ON o.id=r.snapshot_id AND o.state='ready' WHERE r.opens_at<=? AND NOT EXISTS(SELECT 1 FROM meme_settlements s WHERE s.round_id=r.id AND s.state='finalized') ORDER BY r.closes_at LIMIT 10",
    now,
  );
  for (const r of active) {
    if (r.closes_at <= now) {
      await enqueue(db, `settle:${r.id}`, "settle", r.id, {}, r.closes_at, now);
    } else {
      // Coalesce updates. Finish the existing roster before capturing a newer one.
      if (
        !(await one(
          db,
          "SELECT id FROM meme_jobs WHERE kind='score' AND subject=? AND state IN('queued','running')",
          r.id,
        ))
      ) {
        const slot = Math.floor(now / 60000) * 60000;
        const id = `score:${r.id}:${slot}`;
        if (!(await one(db, "SELECT id FROM meme_jobs WHERE id=?", id)))
          await enqueue(db, id, "score", r.id, { asOf: now }, slot, now);
      }
    }
  }
  const job = await claimJob(db, now);
  return job ? runJob(db, job, now) : { state: "idle" };
}
export async function operationsRequest(
  db: Database,
  request: Request,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/meme/operator/operations")) return null;
  const actor = await operator(db, request);
  if (path.endsWith("/jobs") && request.method === "GET")
    return json(
      await rows(
        db,
        "SELECT id,kind,subject,state,attempts,due_at,retry_at,last_error FROM meme_jobs ORDER BY created_at DESC LIMIT 100",
      ),
    );
  requireThat(request.method === "POST", 405, "Method not allowed");
  if (path.endsWith("/tick")) {
    await payload(request, []);
    return json(await tick(db));
  }
  if (path.endsWith("/retry")) {
    const p = await payload(request, ["id"]),
      id = text(p.id, "job ID", 200);
    await run(
      db,
      "UPDATE meme_jobs SET state='queued',retry_at=0,last_error=NULL WHERE id=? AND state='blocked'",
      id,
    );
    return json({ id, actor });
  }
  if (path.endsWith("/prepare")) {
    const p = await payload(request, ["at", "round"]),
      body = p.round;
    requireThat(
      body && typeof body === "object" && !Array.isArray(body),
      400,
      "Operator-reviewed round required",
    );
    const id = text((body as Record<string, unknown>).id, "round ID", 80),
      at = integer(p.at, "preparation time");
    await enqueue(db, "prepare:" + id, "prepare", id, body, at);
    return json({ id, actor });
  }
  throw new Problem(404, "Unknown operations route");
}

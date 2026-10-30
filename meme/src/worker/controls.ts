import { canonical } from "../shared/canonical";
import {
  one,
  rows,
  requireThat,
  integer,
  text,
  sha,
  type Database,
} from "./db";
export const CONTROL_NAMES = [
  "serving",
  "participation",
  "operations",
  "collection",
] as const;
export type ControlName = (typeof CONTROL_NAMES)[number];
export interface Control {
  name: ControlName;
  paused: number;
  version: number;
  updated_at: number;
}
const publicControl = (c: Control) => ({
  name: c.name,
  paused: c.paused === 1,
  version: c.version,
  updatedAt: c.updated_at,
});
export async function control(db: Database, name: ControlName) {
  const value = await one<Control>(
    db,
    "SELECT name,paused,version,updated_at FROM meme_safety_controls WHERE name=?",
    name,
  );
  requireThat(
    value &&
      Number.isSafeInteger(value.version) &&
      value.version >= 0 &&
      [0, 1].includes(value.paused),
    503,
    "Safety controls are not configured",
  );
  return value;
}
export async function controls(db: Database) {
  const values = await rows<Control>(
    db,
    "SELECT name,paused,version,updated_at FROM meme_safety_controls ORDER BY name",
  );
  requireThat(
    values.length === CONTROL_NAMES.length &&
      CONTROL_NAMES.every((name) =>
        values.some(
          (c) =>
            c.name === name &&
            Number.isSafeInteger(c.version) &&
            c.version >= 0 &&
            [0, 1].includes(c.paused),
        ),
      ),
    503,
    "Safety controls are not configured",
  );
  return values.map(publicControl);
}
export async function requireUnpaused(db: Database, name: ControlName) {
  requireThat(
    (await control(db, name)).paused === 0,
    503,
    `${name.charAt(0).toUpperCase() + name.slice(1)} is paused`,
  );
}
interface Change {
  id: string;
  name: ControlName;
  expected_version: number;
  result_version: number;
  paused: number;
  changed_at: number;
  request_hash: string;
}
/** CAS and immutable request receipts share one transaction. Retrying an old
 * receipt reports the CURRENT control; it never re-applies an old pause/resume. */
export async function changeControl(
  db: Database,
  p: Record<string, unknown>,
  actor: string,
  now = Date.now(),
) {
  const id = text(p.key, "control retry key", 100),
    name = text(p.name, "control name", 32);
  requireThat(
    /^[A-Za-z0-9_-]{8,100}$/.test(id),
    400,
    "Control retry key required",
  );
  requireThat(
    CONTROL_NAMES.includes(name as ControlName),
    400,
    "Unknown non-financial control",
  );
  requireThat(
    typeof p.paused === "boolean",
    400,
    "Explicit paused state required",
  );
  const expected = integer(
      p.expectedVersion,
      "expected version",
      0,
      Number.MAX_SAFE_INTEGER - 1,
    ),
    reason = text(p.reason, "control reason", 240).trim();
  requireThat(reason.length > 0, 400, "Control reason required");
  const paused = p.paused ? 1 : 0,
    requestHash = await sha(
      canonical({ name, expected, paused, reason, actor }),
    );
  const existing = await one<Change>(
    db,
    "SELECT * FROM meme_control_changes WHERE id=?",
    id,
  );
  const respond = async (change: Change, replayed: boolean) => ({
    change: {
      key: change.id,
      name: change.name,
      paused: change.paused === 1,
      version: change.result_version,
      changedAt: change.changed_at,
    },
    control: publicControl(await control(db, change.name)),
    replayed,
  });
  if (existing) {
    requireThat(
      existing.request_hash === requestHash,
      409,
      "Control retry key payload changed",
    );
    return respond(existing, true);
  }
  await control(db, name as ControlName);
  const result = await db.batch([
    db
      .prepare(
        "INSERT INTO meme_control_changes SELECT ?,name,version,version+1,?,?,?,?,? FROM meme_safety_controls WHERE name=? AND version=? ON CONFLICT(id) DO NOTHING",
      )
      .bind(id, paused, reason, actor, requestHash, now, name, expected),
    db
      .prepare(
        "UPDATE meme_safety_controls SET paused=?,version=version+1,updated_at=?,reason=?,actor=? WHERE name=? AND version=? AND EXISTS(SELECT 1 FROM meme_control_changes WHERE id=? AND request_hash=?)",
      )
      .bind(paused, now, reason, actor, name, expected, id, requestHash),
    db
      .prepare(
        "INSERT INTO meme_audit(at,actor,action,subject,detail) SELECT ?,?,'safety-control',?,? WHERE changes()=1",
      )
      .bind(
        now,
        actor,
        name,
        canonical({ key: id, paused: !!paused, version: expected + 1, reason }),
      ),
  ]);
  const accepted = await one<Change>(
    db,
    "SELECT * FROM meme_control_changes WHERE id=?",
    id,
  );
  requireThat(
    accepted && accepted.request_hash === requestHash,
    409,
    "Controls changed; refresh status and retry",
  );
  return respond(accepted, result[1].meta.changes === 0);
}

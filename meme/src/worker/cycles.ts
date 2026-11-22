import {
  one,
  run,
  json,
  payload,
  requireThat,
  text,
  sha,
  random,
  type Database,
} from "./db";
import { dailyTimes, DAY_MS, type Attribute } from "../shared/rules";
import { attributeOrder } from "../shared/scoring";
import { canonical } from "../shared/canonical";
export interface Cycle {
  id: string;
  start_day: string;
  seed: string;
  commitment: string;
  order_json: string;
  sealed_at: number;
}
export async function sealCycle(db: Database, id: string, startDay: string) {
  requireThat(
    dailyTimes(startDay).opensAt > Date.now(),
    400,
    "Seal the cycle before its first round opens",
  );
  const existing = await one<Cycle>(
    db,
    "SELECT * FROM meme_attribute_cycles WHERE id=?",
    id,
  );
  if (existing) {
    requireThat(
      existing.start_day === startDay,
      409,
      "Cycle already sealed for another date",
    );
    return { id, commitment: existing.commitment };
  }
  const seed = random(),
    order = await attributeOrder(seed),
    commitment = await sha(`10x-cycle-v1:${id}:${startDay}:${seed}`);
  await run(
    db,
    "INSERT INTO meme_attribute_cycles VALUES(?,?,?,?,?,?)",
    id,
    startDay,
    seed,
    commitment,
    canonical(order),
    Date.now(),
  );
  return { id, commitment };
}
export async function cycleAttribute(
  db: Database,
  id: string,
  closesAt: number,
) {
  const c = await one<Cycle>(
    db,
    "SELECT * FROM meme_attribute_cycles WHERE id=?",
    id,
  );
  requireThat(c, 404, "Cycle not found");
  const index = Math.floor(
    (Date.parse(new Date(closesAt).toISOString().slice(0, 10) + "T00:00:00Z") -
      Date.parse(c.start_day + "T00:00:00Z")) /
      DAY_MS,
  );
  requireThat(index >= 0 && index < 10, 400, "Round outside cycle");
  return {
    attribute: (JSON.parse(c.order_json) as Attribute[])[index],
    index,
    commitment: c.commitment,
  };
}
export async function cycleRequest(
  db: Database,
  request: Request,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === "/api/meme/operator/cycles") {
    const { operator, audit } = await import("./rounds");
    requireThat(request.method === "POST", 405, "Method not allowed");
    const actor = await operator(db, request),
      p = await payload(request, ["id", "startDay"]);
    const result = await sealCycle(
      db,
      text(p.id, "cycle ID", 80),
      text(p.startDay, "start day", 10),
    );
    await audit(db, actor, "seal-cycle", result.id, {
      commitment: result.commitment,
    });
    return json(result);
  }
  const match = path.match(/^\/api\/meme\/cycles\/([^/]+)$/);
  if (!match) return null;
  requireThat(request.method === "GET", 405, "Method not allowed");
  const cycle = await one<Cycle>(
    db,
    "SELECT * FROM meme_attribute_cycles WHERE id=?",
    match[1],
  );
  requireThat(cycle, 404, "Cycle not found");
  const end = dailyTimes(cycle.start_day).closesAt + 9 * DAY_MS;
  return json({
    id: cycle.id,
    startDay: cycle.start_day,
    commitment: cycle.commitment,
    sealedAt: cycle.sealed_at,
    ...(Date.now() >= end
      ? { seed: cycle.seed, order: JSON.parse(cycle.order_json) }
      : {}),
  });
}

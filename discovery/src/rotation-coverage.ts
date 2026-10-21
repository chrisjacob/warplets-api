import { readGmgnDailyCohort } from "./gmgn-rotation";
import { RotationCoverage, RotationKind, type RotationCoverageReport } from "./rotation-coverage-model";

type Counts = RotationCoverageReport["counts"];
const empty = (): Counts => ({ attempted: 0, recorded_succeeded: 0, failed: 0, pending: 0, configured_weight: 0 });
const add = (to: Counts, from: Counts) => { for (const key of Object.keys(to) as (keyof Counts)[]) to[key] += from[key]; };

/** Cache-only operational accounting. A succeeded state is not receipt replay or token-quality evidence. */
export async function rotationCoverage(db: D1Database, now = new Date()): Promise<RotationCoverageReport> {
  const cutoff = now.toISOString(), midnight = Date.parse(`${cutoff.slice(0, 10)}T00:00:00.000Z`);
  const days: RotationCoverageReport["days"] = [], totals = empty();
  const selected = new Set<string>(), attempted = new Set<string>(), novel = new Set<string>(), novelDays = new Set<string>();
  const usage = await db.prepare(`SELECT day,count(*) AS n FROM tenx_source_reservations WHERE day>=?1 AND day<=?2
    AND reserved_at<=?3 AND substr(reserved_at,1,10)=day
    AND json_extract(request,'$.kind') IN ('gmgn_token_info','gmgn_token_security','gmgn_token_pool','gmgn_token_candles') GROUP BY day`)
    .bind(new Date(midnight - 13 * 86400000).toISOString().slice(0, 10), cutoff.slice(0, 10), cutoff).all<{ day: string; n: number }>();
  for (let offset = 0; offset < 14; offset++) {
    const day = new Date(midnight - offset * 86400000).toISOString().slice(0, 10);
    const saved = await readGmgnDailyCohort(db, day);
    const manifest = saved && saved.manifest.cutoff <= cutoff ? saved.manifest : null;
    const row: RotationCoverageReport["days"][number] = { day, manifest_cutoff: manifest?.cutoff ?? null,
      all_core_attempts: usage.results.find(r => r.day === day)?.n ?? 0,
      scheduled_baseline_remaining: Math.max(0, 21 - (usage.results.find(r => r.day === day)?.n ?? 0)),
      manifest_hash: manifest ? saved!.manifest_hash : null, inventory: manifest?.inventory.length ?? 0,
      regression_fixtures: manifest?.inventory.filter(r => r.disposition === "regression_fixture").length ?? 0, targets: [], counts: empty() };
    if (manifest?.selected.length) {
      const addresses = JSON.stringify(manifest.selected);
      // Include all GMGN attempts before the frozen cutoff, including failures.
      // Novelty means new to this retained GMGN investigation history, not new to the market or safe.
      const previous = await db.prepare(`SELECT json_extract(request,'$.address') AS address,count(*) AS n FROM tenx_source_reservations
        WHERE reserved_at<?1 AND substr(json_extract(request,'$.kind'),1,5)='gmgn_'
        AND json_extract(request,'$.address') IN (SELECT value FROM json_each(?2)) GROUP BY address`).bind(manifest.cutoff, addresses).all<{ address: string; n: number }>();
      const prior = new Map(previous.results.map(r => [r.address, r.n]));
      const counts = await db.prepare(`SELECT json_extract(request,'$.address') AS address,json_extract(request,'$.kind') AS kind,
        count(*) AS attempted,sum(state='succeeded') AS recorded_succeeded,sum(state='failed') AS failed,sum(state IN ('reserved','fetching')) AS pending
        FROM tenx_source_reservations WHERE day=?1 AND reserved_at>=?2 AND reserved_at<=?3 AND reserved_at<?5
        AND json_extract(request,'$.address') IN (SELECT value FROM json_each(?4))
        AND json_extract(request,'$.kind') IN ('gmgn_token_info','gmgn_token_security','gmgn_token_pool','gmgn_token_candles') GROUP BY address,kind`)
        .bind(day, manifest.cutoff, cutoff, addresses, new Date(Date.parse(`${day}T00:00:00.000Z`) + 86400000).toISOString()).all<{ address: string; kind: string; attempted: number; recorded_succeeded: number; failed: number; pending: number }>();
      for (const address of manifest.selected) {
        const entry = manifest.inventory.find(r => r.address === address)!;
        const first = entry.last_selected_day === null, previousAttempts = prior.get(address) ?? 0;
        const kinds = RotationKind.options.map(kind => {
          const found = counts.results.find(r => r.address === address && r.kind === kind);
          const count = found ? { attempted: found.attempted, recorded_succeeded: found.recorded_succeeded, failed: found.failed, pending: found.pending,
            configured_weight: found.attempted * (kind === "gmgn_token_candles" ? 2 : 1) } : empty();
          add(row.counts, count); return { kind, counts: count };
        });
        const hasAttempt = kinds.some(k => k.counts.attempted > 0), newly = first && previousAttempts === 0 && hasAttempt;
        selected.add(address); if (hasAttempt) attempted.add(address); if (newly) { novel.add(address); novelDays.add(day); }
        row.targets.push({ address, first_selection: first, prior_gmgn_attempts: previousAttempts, newly_investigated: newly, kinds });
      }
    }
    add(totals, row.counts); days.push(row);
  }
  return RotationCoverage.parse({ version: "gmgn-rotation-coverage-v1", cutoff, window_days: 14, scope: "retained_selection_and_attempt_metadata", days,
    counts: totals, distinct_selected: selected.size, distinct_attempted: attempted.size, newly_investigated: novel.size, new_investigation_days: novelDays.size,
    target: { mints: 30, utc_days: 3, data_quality_pass: null }, receipt_payloads_replayed: false, provider_requests: 0, database_writes: 0,
    scoring_effect: "none", evidence_gates_changed: false });
}

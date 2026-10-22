import { z } from "zod";
import { Address, Signature } from "./model";
import { SignatureRows, SourceError, type SignatureRow } from "./rpc";
import type { Control } from "./store";

export const MIGRATION_HARVEST_PAGE_SIZE = 30;
const fields = ["harvest_head", "harvest_before", "harvest_before_slot", "harvest_revision", "harvest_commit", "harvest_authority"] as const;
const Checkpoint = z.object({
  migration_cursor: Signature.nullable(), last_harvest: z.string().datetime().nullable(),
  harvest_head: Signature.nullable(), harvest_before: Signature.nullable(),
  harvest_before_slot: z.number().int().safe().nonnegative().nullable(),
  harvest_revision: z.number().int().safe().nonnegative().max(Number.MAX_SAFE_INTEGER - 1),
  harvest_commit: z.uuid().nullable(),
  harvest_authority: Address.nullable(),
}).refine(v => (v.harvest_head === null && v.harvest_before === null && v.harvest_before_slot === null)
  || (v.harvest_head !== null && v.harvest_before !== null && v.harvest_before_slot !== null && v.harvest_authority !== null), "harvest_continuation_incomplete");
export type HarvestCheckpoint = z.infer<typeof Checkpoint>;
export type HarvestControl = Pick<Control, "migration_cursor" | "last_harvest" | "harvest_head" | "harvest_before" | "harvest_before_slot" | "harvest_revision" | "harvest_commit" | "harvest_authority">;
export function harvestCheckpointReady(state: HarvestControl): boolean {
  return fields.every(key => Object.prototype.hasOwnProperty.call(state, key));
}
export function readHarvestCheckpoint(state: HarvestControl): HarvestCheckpoint | null {
  if (!harvestCheckpointReady(state)) return null;
  const parsed = Checkpoint.safeParse(state);
  if (!parsed.success) throw new SourceError("migration_harvest_checkpoint_invalid");
  return parsed.data;
}
export function migrationHarvestRequest(checkpoint: HarvestCheckpoint) {
  return { limit: MIGRATION_HARVEST_PAGE_SIZE, before: checkpoint.harvest_before ?? undefined,
    until: checkpoint.migration_cursor ?? undefined };
}
export function assertHarvestAuthority(checkpoint: HarvestCheckpoint, authority: string) {
  if (!Address.safeParse(authority).success || checkpoint.harvest_authority !== null && checkpoint.harvest_authority !== authority) {
    throw new SourceError("migration_harvest_authority_changed");
  }
}
export function migrationHarvestTransition(checkpoint: HarvestCheckpoint, raw: unknown, at: Date) {
  const parsed = SignatureRows.safeParse(raw);
  if (!parsed.success) throw new SourceError("migration_harvest_page_invalid");
  const rows = parsed.data;
  if (rows.length > MIGRATION_HARVEST_PAGE_SIZE || new Set(rows.map(row => row.signature)).size !== rows.length
    || rows.some((row, index) => row.signature === checkpoint.harvest_before || row.signature === checkpoint.migration_cursor || row.signature === checkpoint.harvest_head
      || row.err === undefined || row.confirmationStatus !== "finalized" || row.blockTime !== null && row.blockTime * 1000 > at.getTime()
      || checkpoint.harvest_before_slot !== null && row.slot > checkpoint.harvest_before_slot
      || index > 0 && row.slot > rows[index - 1]!.slot)) throw new SourceError("migration_harvest_page_invalid");
  // RPC transaction order within a slot is not lexical signature order.
  const continuing = rows.length === MIGRATION_HARVEST_PAGE_SIZE;
  const head = checkpoint.harvest_head ?? rows[0]?.signature ?? checkpoint.migration_cursor;
  return { rows, state: continuing ? "continuing" as const : "boundary_observed" as const,
    next: { migration_cursor: continuing ? checkpoint.migration_cursor : head,
      harvest_head: continuing ? head : null, harvest_before: continuing ? rows.at(-1)!.signature : null,
      harvest_before_slot: continuing ? rows.at(-1)!.slot : null } };
}
export type MigrationHarvestResult = { state: "not_due" | "migration_required"; exhaustive: false }
  | { state: "continuing" | "boundary_observed"; observed: number; queued: number; exhaustive: false };

export async function commitMigrationHarvest(db: D1Database, owner: string, checkpoint: HarvestCheckpoint,
  rows: SignatureRow[], at: Date, authority: string): Promise<MigrationHarvestResult> {
  assertHarvestAuthority(checkpoint, authority);
  const transition = migrationHarvestTransition(checkpoint, rows, at), next = transition.next, commit = crypto.randomUUID();
  const guard = "EXISTS(SELECT 1 FROM tenx_control WHERE id=1 AND lease_owner=?1 AND lease_until>?2 AND paused=0 AND harvest_commit=?3)";
  const accepted = transition.rows.filter(row => row.err === null);
  const written = await db.batch([
    db.prepare(`UPDATE tenx_control SET last_harvest=?2,migration_cursor=?3,harvest_head=?4,harvest_before=?5,
      harvest_before_slot=?6,harvest_revision=harvest_revision+1,harvest_commit=?7,harvest_authority=?15
      WHERE id=1 AND lease_owner=?1 AND lease_until>?2 AND paused=0 AND harvest_revision=?8
      AND migration_cursor IS ?9 AND harvest_head IS ?10 AND harvest_before IS ?11
      AND harvest_before_slot IS ?12 AND harvest_commit IS ?13 AND last_harvest IS ?14 AND harvest_authority IS ?16
      AND NOT EXISTS(SELECT 1 FROM json_each(?17) j JOIN tenx_pending_signatures p
        ON p.signature=json_extract(j.value,'$.signature') WHERE p.slot<>json_extract(j.value,'$.slot'))`)
      .bind(owner, at.toISOString(), next.migration_cursor, next.harvest_head, next.harvest_before, next.harvest_before_slot,
        commit, checkpoint.harvest_revision, checkpoint.migration_cursor, checkpoint.harvest_head, checkpoint.harvest_before,
        checkpoint.harvest_before_slot, checkpoint.harvest_commit, checkpoint.last_harvest, authority, checkpoint.harvest_authority,
        JSON.stringify(transition.rows)),
    // An existing signature with a different slot violates its identity and rolls
    // back the entire batch. Identical inbox rows retain all original history.
    db.prepare(`INSERT INTO tenx_pending_signatures(signature,slot,queued_at)
      SELECT json_extract(j.value,'$.signature'),json_extract(j.value,'$.slot'),?2 FROM json_each(?4) j WHERE ${guard}
      ON CONFLICT(signature) DO UPDATE SET slot=NULL WHERE tenx_pending_signatures.slot<>excluded.slot`)
      .bind(owner, at.toISOString(), commit, JSON.stringify(accepted)),
  ]);
  if (written[0]!.meta.changes !== 1) throw new SourceError("migration_harvest_lease_or_checkpoint_changed");
  return { state: transition.state, observed: rows.length, queued: written[1]!.meta.changes ?? 0, exhaustive: false };
}

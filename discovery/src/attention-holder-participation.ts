import { z } from "zod";
import { Address } from "./model";
import { holderAcquisitionInputs } from "./holder-acquisition-store";
import { reviewHolderParticipation } from "./holder-participation";

export function attentionHolderRequest(address: string, params: URLSearchParams, now = new Date()) {
  const mint = Address.parse(address);
  const entries = z.array(z.tuple([z.literal("cutoff"), z.iso.datetime()])).length(1).parse([...params]);
  const cutoff = entries[0]![1];
  const at = z.string().refine(value => Number.isFinite(now.getTime()) && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value && Date.parse(value) <= now.getTime()).parse(cutoff);
  return { address: mint, at: new Date(at) };
}
// Existing bounded archives and qualification policy only. No candidate lookup,
// collection, write, history substitution or unrelated trade-sample projection.
export async function attentionHolderParticipation(db: D1Database, address: string, at: Date) {
  return reviewHolderParticipation(await holderAcquisitionInputs(db, address, at));
}

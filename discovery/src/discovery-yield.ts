import {z} from "zod";
import {DEFAULT_POLICY} from "./model";
import {readHarvestCheckpoint,MIGRATION_HARVEST_PAGE_SIZE} from "./migration-harvest";
import {DiscoveryYield} from "./discovery-yield-model";

const ControlProjection=z.object({migration_cursor:z.string().nullable(),last_harvest:z.string().nullable(),harvest_head:z.string().nullable().optional(),harvest_before:z.string().nullable().optional(),harvest_before_slot:z.number().nullable().optional(),harvest_revision:z.number().optional(),harvest_commit:z.string().nullable().optional(),harvest_authority:z.string().nullable().optional()});
// A single read transaction, aggregate counts only. It never loads all evidence,
// reassesses a pass, reads provider credentials or makes source requests.
export async function discoveryYield(db:D1Database,now=new Date()){
  const cutoff=now.toISOString(),query=db.prepare(`WITH candidate_rows AS (
    SELECT c.address,e.address AS expired,CASE WHEN json_valid(c.payload) THEN c.payload ELSE '{}' END AS p
    FROM tenx_candidates c LEFT JOIN tenx_candidate_expiry e ON e.address=c.address WHERE c.mode='live'
  ), candidate_fields AS (
    SELECT *,CASE WHEN json_extract(p,'$.address')=address AND json_extract(p,'$.mode')='live' AND json_extract(p,'$.chain')='solana' THEN 1 ELSE 0 END AS valid,
      julianday(json_extract(p,'$.creation.block_time')) AS created,julianday(json_extract(p,'$.graduation.block_time')) AS graduated,
      julianday(json_extract(p,'$.market.fetched_at')) AS fetched,julianday(json_extract(p,'$.market.observed_at')) AS observed
    FROM candidate_rows
  ), candidate_counts AS (
    SELECT count(*) AS retained,coalesce(sum(expired IS NULL),0) AS active,
      coalesce(sum(valid=1 AND expired IS NULL AND created IS NULL),0) AS active_creation_unknown,
      coalesce(sum(valid=1 AND created BETWEEN julianday(?1)-1 AND julianday(?1)),0) AS created_24h,
      coalesce(sum(valid=1 AND graduated BETWEEN julianday(?1)-1 AND julianday(?1)),0) AS graduated_24h,
      coalesce(sum(valid=1 AND created IS NULL AND graduated BETWEEN julianday(?1)-1 AND julianday(?1)),0) AS graduated_24h_creation_unknown,
      coalesce(sum(valid=1 AND json_type(p,'$.market')='object'),0) AS with_market,
      coalesce(sum(valid=1 AND fetched BETWEEN julianday(?1)-?2/86400.0 AND julianday(?1) AND (json_extract(p,'$.market.observed_at') IS NULL OR observed<=julianday(?1))),0) AS fresh_market,
      coalesce(sum(valid=1 AND fetched BETWEEN julianday(?1)-?2/86400.0 AND julianday(?1) AND (json_extract(p,'$.market.observed_at') IS NULL OR observed<=julianday(?1)) AND json_type(p,'$.market.volume_24h_usd') IN ('integer','real') AND json_extract(p,'$.market.volume_24h_usd')>=0),0) AS fresh_reported_volume,
      coalesce(sum(valid=1 AND expired IS NULL AND fetched BETWEEN julianday(?1)-?2/86400.0 AND julianday(?1) AND (json_extract(p,'$.market.observed_at') IS NULL OR observed<=julianday(?1))),0) AS active_fresh_market,
      coalesce(sum(valid=1 AND expired IS NULL AND fetched BETWEEN julianday(?1)-?2/86400.0 AND julianday(?1) AND (json_extract(p,'$.market.observed_at') IS NULL OR observed<=julianday(?1)) AND json_type(p,'$.market.volume_24h_usd') IN ('integer','real') AND json_extract(p,'$.market.volume_24h_usd')>=0),0) AS active_fresh_reported_volume,
      coalesce(sum(valid=0),0) AS invalid_cached_identity
    FROM candidate_fields
  ), lead_rows AS (
    SELECT checked_at,CASE WHEN json_valid(migration_tx) THEN migration_tx ELSE '{}' END AS p,json_valid(migration_tx) AS valid FROM tenx_leads
  ), lead_counts AS (
    SELECT count(*) AS observed,coalesce(sum(checked_at IS NULL),0) AS unchecked,
      coalesce(sum(json_type(p,'$.blockTime')='integer' AND json_extract(p,'$.blockTime') BETWEEN ?3-86400 AND ?3),0) AS graduated_24h,
      coalesce(sum(checked_at IS NULL AND json_type(p,'$.blockTime')='integer' AND json_extract(p,'$.blockTime') BETWEEN ?3-86400 AND ?3),0) AS unchecked_graduated_24h,
      coalesce(sum(valid=0 OR json_type(p)<>'object'),0) AS invalid_cached_json
    FROM lead_rows
  ), signature_counts AS (
    SELECT count(*) AS observed,coalesce(sum(processed_at IS NULL),0) AS pending,min(CASE WHEN processed_at IS NULL THEN queued_at END) AS oldest_pending_at FROM tenx_pending_signatures
  ) SELECT json_object('retained',c.retained,'active',c.active,'active_creation_unknown',c.active_creation_unknown,'created_24h',c.created_24h,'graduated_24h',c.graduated_24h,'graduated_24h_creation_unknown',c.graduated_24h_creation_unknown,'with_market',c.with_market,'fresh_market',c.fresh_market,'fresh_reported_volume',c.fresh_reported_volume,'active_fresh_market',c.active_fresh_market,'active_fresh_reported_volume',c.active_fresh_reported_volume,'invalid_cached_identity',c.invalid_cached_identity) AS candidates,
    json_object('observed',l.observed,'unchecked',l.unchecked,'graduated_24h',l.graduated_24h,'unchecked_graduated_24h',l.unchecked_graduated_24h,'invalid_cached_json',l.invalid_cached_json) AS leads,
    json_object('observed',s.observed,'pending',s.pending,'oldest_pending_at',s.oldest_pending_at) AS signatures
    FROM candidate_counts c CROSS JOIN lead_counts l CROSS JOIN signature_counts s`).bind(cutoff,DEFAULT_POLICY.max_market_age_seconds,now.getTime()/1000);
  const [counts,control]=await db.batch([query,db.prepare("SELECT * FROM tenx_control WHERE id=1")]);
  const raw=z.object({candidates:z.string(),leads:z.string(),signatures:z.string()}).parse(counts!.results[0]);
  let checkpoint:"migration_required"|"idle"|"continuing"|"invalid"="invalid";
  try{const saved=readHarvestCheckpoint(ControlProjection.parse(control!.results[0]));checkpoint=saved?(saved.harvest_before?"continuing":"idle"):"migration_required";}catch{/* Diagnostics remain held; never repair checkpoint state. */}
  return DiscoveryYield.parse({version:"discovery-yield-v1",cutoff,scope:"retained_pipeline_not_market",candidates:JSON.parse(raw.candidates),leads:JSON.parse(raw.leads),signatures:JSON.parse(raw.signatures),harvest:{checkpoint,page_size:MIGRATION_HARVEST_PAGE_SIZE,exhaustive:false},market_recall:"not_measured",ranking:"v4_structural_support",qualified_attention_in_rank:false,receipt_payloads_replayed:false,provider_requests:0,database_writes:0,evidence_gates_changed:false});
}

import {sql} from '../storage/atomic-driver.mjs';
import {canonicalJson} from '../security/canonical.mjs';
import {demand} from './inventory.mjs';

// Explicit application inventory. A new migration adding a business table must
// add it here before a private backup can claim completeness.
export const BUSINESS_TABLES=Object.freeze(`app_recorded_attempt_preparations app_recorded_attempt_expiries app_recorded_transaction_outcomes app_economic_intents app_economic_preparations app_artifact_publications app_collection_legacy_adoptions app_collection_legacy_stage_imports app_collection_legacy_mint_anchors app_collection_legacy_adoption_objects app_collection_authorities app_collection_cut_records app_collection_cut_attempts app_collection_cut_pages app_collection_free_cuts app_collection_mint_admissions app_collection_mint_fulfillments app_collection_stages app_collection_quotes app_collection_fulfillments app_collection_reservations app_collection_operation_conflicts app_collection_observation_bindings app_collection_eligibility_pages app_collection_records app_collection_list_seals app_collection_source_seals app_command_receipts app_complete_inputs app_epoch_freezes app_epoch_inputs app_evidence_heads app_evidence_receipts app_evidence_sources app_execution_fences app_governance_publications app_job_attempts app_job_events app_job_outbox app_jobs app_operator_scopes app_private_artifacts app_provider_attempts app_quote_bindings app_quote_heads app_quote_inputs app_quote_account_slots app_revisions app_settlement_dependencies app_settlement_incidents app_snapshot_attempts
collect_assets collect_inventories collect_level_history collect_observations collect_operations collect_snapshots
earn_action_catalog earn_action_changes earn_action_completions earn_admission_counts earn_allocations earn_awards earn_boards earn_decisions earn_fixture_campaigns earn_issuer_grants earn_issuer_revocations earn_known_collections earn_member_facts earn_owner_assets earn_owner_snapshots earn_position_cutoffs earn_position_enrollments earn_position_events earn_recovered_allocations earn_recovered_awards earn_recovered_boards earn_reviews earn_signed_completions earn_stake_reads earn_streaks earn_submissions earn_workload_policies
fair_inventories fair_requests fair_reserved_assets fair_results genesis_ballots genesis_decisions genesis_voters genesis_votes local_campaign_registry manifest_catalog market_fixtures notice_consent_requests notice_inbox notice_outbox notice_preferences ops_config_audit ops_optional_spend ops_scope_log ops_usage price_observations price_sources quote_pool_snapshots quote_sources stake_fixture_events stake_fixture_farms tx_attempts tx_intents tx_receipts tx_request_keys vault_assets vault_claim_totals vault_manifests vault_observations`.split(/\s+/).sort());
export const AUTH_TABLES=Object.freeze(['auth_challenges','edge_proof_consumptions','request_limits','sessions']);
export const CONTROL_TABLES=Object.freeze(['app_recovery_state','app_recovery_runs','app_recovery_pages','app_recovery_watermark','app_recovery_captures','app_recovery_capture_pages','app_recovery_capture_objects','app_recovery_reconcile_checks','app_recovery_row_fragments','app_collection_legacy_audits','app_collection_legacy_relations','app_collection_legacy_economics','app_collection_legacy_economic_stages','app_collection_legacy_economic_phases','app_collection_legacy_preparations','app_collection_legacy_prepared_stages','app_collection_legacy_prepared_admissions','app_collection_legacy_object_candidates','app_collection_legacy_prepared_objects']);
// Pinned local D1's own metadata is infrastructure state, not application data.
const known=new Set([...BUSINESS_TABLES,...AUTH_TABLES,...CONTROL_TABLES,'schema_versions','_cf_METADATA']);
export const quote=name=>{demand(/^[a-z][a-z0-9_]*$/.test(name),'Invalid schema identifier.');return '"'+name+'"';};
export const tableListSql=()=>sql("SELECT name,sql FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
export async function readSchema(driver){
 const [{rows}]=await driver.batch([tableListSql()]);
 demand(rows.every(r=>known.has(r.name)),'Unknown table prevents complete recovery export: '+rows.filter(r=>!known.has(r.name)).map(r=>r.name).join(','));
 demand([...BUSINESS_TABLES,...AUTH_TABLES,...CONTROL_TABLES].every(name=>rows.some(r=>r.name===name)),'Recovery schema is incomplete.');
 const names=rows.filter(r=>BUSINESS_TABLES.includes(r.name)),details=await driver.batch(names.map(r=>sql('SELECT name,type,pk FROM pragma_table_info(?) ORDER BY cid',r.name)));
 const tables=names.map((r,n)=>{const fields=details[n].rows;demand(fields.length>0&&fields.every(f=>['TEXT','INTEGER'].includes(f.type)),'Unsupported recovery column type.');
  return {name:r.name,columns:fields.map(f=>f.name),primaryKey:fields.filter(f=>f.pk>0).sort((a,b)=>a.pk-b.pk).map(f=>f.name),hasRowid:!/^.*\bWITHOUT\s+ROWID\b/is.test(r.sql)};
 });
 return {tables,signature:canonicalJson(rows)};
}
export function rowExpression(table){return 'json_array('+[...(table.hasRowid?['rowid']:[]),...table.columns.map(quote)].join(',')+')';}
export function rowOrder(table){return table.hasRowid?'rowid':table.primaryKey.map(quote).join(',');}
export function objectRow(table,row){const offset=table.hasRowid?1:0;return Object.fromEntries(table.columns.map((name,index)=>[name,row[index+offset]]));}

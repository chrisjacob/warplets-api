# Continuing implementation checkpoint

Branch work/10x-prd-foundation. B08 is locally verified and awaiting its tested milestone commit/push. Previous pushed handoff 7827a15; B07 product 30b9630 passed CI42116935604. Continue immediately into B20-core after recording B08's commit, while following test-only CI.

B00–B07 and B09 are verified. B08 now passes immutable publication and separate public/private recovery acceptance. B10 remains partial; B20-core is next, and B20 must be skipped after core until full-profile prerequisites pass.

Publication stages exact bytes privately, records source/job identity under the current lease, conditionally creates the public object, verifies readback and atomically publishes its catalog entry. Unknown writes retry the same plan; conflicts remain held. Older bundles and finalized awards are retained. Public retrieval is byte-addressed, while proofs preserve historical semantic commitments.

Public recovery imports independently pinned archives into a permanently mutation-disabled database. Private recovery captures all 86 allowlisted business tables transactionally, verifies schema/audit/object/award continuity, revokes sessions and fences prior leases before permitting local writes. Recovery capabilities cannot escape a transaction, and stale restore batches cannot modify an activated runtime. Larger-than-budget backups are refused explicitly.

Validation:318 reference tests,52 full edge/workerd/D1/R2 tests, final9Node/2D1 recovery tests,13 publication tests, edge TypeScript, generated contract drift, legacy recovery drill, both fixture CLIs and blueprint checks pass. Full edge elapsed393330ms. Private export used347 SQL statements, including one174-statement snapshot; actualD1 restore used44 units with at most17SQL perstep. These are synthetic local measurements, not production guarantees.

Run node platform/earn/settlement-cli.mjs --fixture-rehearsal for cutoff -> board -> allocation -> verified publication. Run node platform/recovery/cli.mjs --fixture-rehearsal for source loss, independent pins and separate public/private restores. Financial execution remains false; declared burns are not chain burns.

Migrations031 and032 add immutable publication/catalog and recovery isolation guards. Next migration033; preserve019 gap. Public artifacts are bounded2MiB, staging128KiB, recovery inventory256KiB and referenced objects24MiB. Capture and reconciliation preflight a conservative900 SQL/object-operation ceiling.

Next executable step: commit/push B08, follow test-only CI, then implement B20-core's single loopback browser origin serving built React and dispatching /api/v1 to real local workerd. Seed genuine synthetic signature/admission/review/evidence through shared services, compare Node/D1 settlement and restore fresh local instances. Frontend agent has browser/dispatcher design; recovery agent has integration comparison design. Coordinator owns shared contracts, migrations and commits.

B10.1 remaining combinations are recorded in platform/site/B10_HANDOFF.md. Use installed pinned dependencies. Scratch/logs remain in work/. Preserve newer/unrelated changes; never reset. No deployment, remote Cloudflare mutation/provisioning, spend, funding, broadcasting, subscriptions, external messages, main/dev merge or force push. Sydney launch hours, later mint prices and all R-stage approvals remain open.

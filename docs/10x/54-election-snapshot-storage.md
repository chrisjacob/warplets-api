# Recover full daily election snapshots with bounded chunk storage

Implemented 21 October 2026 (Australia/Sydney), following PRD §§5.3, 11.2–11.3, 17.2 and 17.6. Local rehearsal only; no votes, launches, payments, deployment or policy activation.

## Failure and resulting behavior

The daily rehearsal stopped with `election_snapshot_size_limit`. Initial read-only inspection found **441 live candidates / 1,619,762 raw payload bytes**, just above the former aggregate 1.6 MB guard. A subsequent offline replay found **442 candidates**, **1,637,981 serialized input bytes** and **202,326 result bytes**, also above the former 200 KB result guard. Raising only the input guard would not have recovered it.

The snapshot now retains the **entire observed inventory** using a versioned storage manifest when needed. It preserves the same portable `election-input-v1`, `discovery-election-v1`, result shape, metadata hashes and replay engine. Chunk storage is an internal representation; it is not a new selection policy. Legacy inline records remain readable and replayable without conversion or rewriting.

## Storage and integrity boundaries

- One SELECT still freezes a consistent inventory, sorted by address. The **500-candidate limit** remains. The 501st row is never silently dropped.
- Individual source rows remain capped at **1,600,000 UTF-8 bytes**. Aggregate raw and serialized input now have an explicit **4,000,000-byte limit**; oversized input fails visibly before persistence. The raw query guards oversized counts/rows/totals before decoding their JSON.
- Inputs up to 1.6 MB can remain inline if the combined input/result storage fits. Otherwise `election-chunks-v1` records the complete input size, original input hash and ordered chunk hashes/byte counts.
- At most **eight chunks**, each at most **512,000 UTF-8 bytes**. Boundaries preserve whole UTF-8 code points. The encoder/reassembler checks byte counts, contiguous ordering, exact part count and every chunk hash before normal schema validation and complete election replay.
- Decision summaries remain bounded at **1.6 MB**. The combined parent row's input/summary fields stay at or below **1.8 MB**; a large summary can force even smaller inputs into chunk storage. This keeps room below the documented [D1 row limit](https://developers.cloudflare.com/d1/platform/limits/).
- The parent, every chunk and audit entry commit in one [D1 transaction batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch). At the eight-chunk ceiling the write batch contains ten statements. No partial snapshot is announced or accepted after chunk/audit failure.
- Every part is bound to its parent manifest by SQL checks and an insert trigger. Parent/part updates and deletes are blocked. A losing same-ID attempt cannot attach its chunks to the winner's record or add a second audit event, including inline-versus-chunked races.
- Readers fail closed on missing, extra, reordered, corrupt or mismatched parts and manifests. Reassembly does not replace input/result/record hash verification or deterministic decision replay.

All existing proof, age, concentration, wallet/funding, freshness, shortlist and capability gates remain. Storage limits are resource bounds, not permission to trim or qualify a candidate. Requests for larger or more numerous inventories still fail explicitly; retention/scope changes need their own design rather than silent truncation.

The additive **local** migration is `0034_election_chunks.sql`, applied to the preserved Discovery store using pinned Wrangler 4.126.0. Existing records, input hashes, source allowances, pause/backoff, timers and evidence stores were preserved. No remote migration or new remote resource was used.

## Live recovery receipt

The **normal maintenance tick** recovered `daily-2026-10-21` at **2026-10-21T00:18:51.215Z / 11:18:51 AEDT**. No forced source refresh or backdated election was used.

- Frozen candidates: **442** — **0 eligible**, **13 provisional**, **429 excluded**, **0 shortlisted**.
- Outcome: **no eligible winner**; voting and launching remain disabled.
- Original serialized inputs: **1,637,981 bytes**, stored in **four** chunks; largest chunk **512,000 bytes**.
- Parent manifest: **589 bytes**; summary including metadata: **202,677 bytes**.
- Input hash: `fe387ecfc196710a4f05309c43d3b020ee2b6325f49dc56e2316be45241b3f10`.
- Result hash: `2e0aa9672dd90781e7adcfd69d545d5d1b82afa54817b187c2e8affa65620d13`.
- Record hash: `8fe0b9189a57f15b1f4d7bed9f47a5895d8a1ae619ce41ea3b4a09c95a1274fc`.

The cached API reassembled and replayed the daily snapshot and historical rehearsals with zero provider calls. The [existing preview](https://app-local.10x.meme/elections/daily-2026-10-21) rendered **Replay verified**, all 442 decisions and the unchanged rules/policy versions. The normal tick cleared the recorded election size error after success. These are historical observations, not a claim that future snapshots cannot hit the declared count/byte bounds.

## Related status correction

Intake's existing **20-request daily subset** is now included as `daily_limits.mint_intake` alongside its usage counter in the public status contract. This fixes cached budget validation after the first intake source reservations; it adds no allowance and does not raise the global RPC cap. OpenAPI retains the same endpoints and portable election record schema.

`scripts/check-discovery-operations.ts` now explicitly includes the latest daily rehearsal even if recent operator rehearsals would otherwise displace it. It reports the election error, exact candidate count and serialized input size for each replayed record. It remains a cached, read-only, zero-provider check.

Kimchi's separate exact-mint request advanced normally to **scanning**: one signature-page receipt, three intake source reservations, no verified migration body and no saved candidate at the cached review. Its page hash replayed without new source calls. This storage fix does not certify Kimchi or resolve its ownership/funding gaps.

## Validation and remaining work

Isolated tests cover full-inventory chunking, unchanged portable hashes and legacy v1 replay, UTF-8 boundary safety, maximum bytes, immutable/idempotent retries, atomic chunk/audit rollback, corruption, extra/missing parts, manifest tampering, same-ID races, pre-decode inventory bounds and the former 200 KB summary case. Existing tests retain the 501-candidate failure and oversized individual-row failure. No test fixtures were written to the running local store.

The final full Discovery suite passed **741 tests across 47 files**, including the **16 storage tests**. Discovery and app typechecks passed; **58 discovery UI tests** passed across nine files. The local app build passed with home startup **234.1 KiB gzip across eleven chunks**, below the unchanged 250 KiB limit. Security smoke denied fifteen private-path requests and passed ten operator origin/body checks, with zero source requests. OpenAPI regeneration remained stable at **89 paths**. The live cached operations check replayed today's complete snapshot plus two old inline snapshots, with `election_error=null` and zero provider requests.

During concurrent regression/build work, one multi-megabyte two-writer test exceeded Vitest's default five-second timeout. Both race exercises now have a fifteen-second test-only allowance; production timing, assertions and watchdog limits are unchanged. The independent watchdog also recorded a transient API-timeout observation, then returned to `degraded` / `restart_recommended=false` on its ordinary check. Wallet source degradation remains a separate reported gap. The final full regression passed separately from the build.

Remaining: ten recently created fully eligible tokens; Kimchi's bounded migration/creation/account/holder/wallet review; non-WSOL quote certification and copycat attribution; explicit live-inventory retention/scope design before the existing 500-candidate bound is exceeded. Production voting, launches, complete funding archives and remote/free-tier execution certification remain outside this local rehearsal milestone.

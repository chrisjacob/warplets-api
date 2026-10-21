# Scratch evidence resolver and complete historical replay

22 October 2026 (Australia/Sydney). Implements the scratch replay step from [118 — complete metadata capacity](118-complete-metadata-capacity.md). All **183 retained score cohorts and nine elections** in the pinned historical snapshot replay with their original hashes after replacing referenced holder/wallet analyses with regenerated results from encrypted payload objects. This completes one offline preservation check; production relocation/adoption and F5 remain partial.

## Implemented

`scripts/discovery-evidence-scratch.mjs` adds `withScratchEvidenceResolver`, with an explicit TypeScript declaration. It admits the private metadata/proof/catalog sources, opens metadata and references read-only, resolves selected original rows through the existing bounded proof/authenticated-object decoder, and checks frozen inputs again before returning a completed session result. Both database connections close in `finally`. The capacity file remains the deliberately stripped experiment from 118; no original reader is redirected to it.

`scripts/lib/evidence-scratch-replay.ts` regenerates a frozen candidate's holder/wallet analyses through that resolver. The existing analysis implementations and score/election replay engines remain unchanged. `scripts/discovery-evidence-scratch-replay.ts` walks the complete archived cohort/election populations, verifies original self-contained records, rebuilds candidates with regenerated analyses and verifies the reconstructed records again. It writes a new private aggregate/hash report after the session's final preservation checks.

```powershell
pnpm exec tsx scripts/discovery-evidence-scratch-replay.ts CAPACITY CAPACITY_PIN REFERENCES REFERENCE_PIN SEALED KEY NEW_PRIVATE_DIRECTORY
pnpm test:discovery-scratch
pnpm exec tsc --noEmit -p tsconfig.evidence-scratch.json
```

Use an existing `.tmp` parent and independently retained pins. Fresh outputs are exclusive and cannot be nested inside existing archive/object/index/reference/capacity/replay artifacts or `.wrangler`. Failed/partial directories remain retained. Existing shared path checks reject links/junction escapes. No key is generated, printed or copied by the real study; the existing dedicated archive key must remain separate from all three input directories. Owner-only output modes are requested; Windows ACLs, hostile concurrent filesystem mutation and key/off-device custody remain uncertified. Reports and all original evidence/session/research files stay ignored/private.

## Source admission and selected recovery

Session admission verifies the complete pinned 118 metadata database and 116 reference database. The capacity report must name the exact admitted reference pin and source archive. The encrypted catalog is authenticated with the separate key, validated through the existing sealed-catalog/source-manifest contract, and required to agree with the reference context's catalog/archive pins and original database hash.

Every catalog entry/object/encrypted descriptor must match its committed reference and the exact corresponding metadata row. Both metadata-table populations must match the complete reference/catalog count. These are whole frozen-file checks, not production root publication, freshness, private authorization or a proof of completeness for arbitrary current list APIs.

Each selected resolution still uses the existing independently pinned proof and envelope checks, one ciphertext object, AES-GCM authentication, gzip/raw sizes and hashes, bounded decompression, exact UTF-8 including BOM/NUL, and complete original-row hash. Missing metadata/references hold with no proof of original absence. Unsupported tables and session bounds hold. The private session permits at most 10,000 resolution attempts and two GiB of successfully recovered raw bytes; these are offline tooling bounds, not new provider/research allowances.

Before completion, the capacity/reference file hashes, sealed envelope/catalog hash, separate key-file identity and zero database-change counters are checked again; database/object/catalog sidecars and unsafe paths hold. A changed frozen catalog in a negative test prevents the session result from being returned. Selected object authentication remains mandatory at the actual read; unrelated objects are not certified merely because their descriptors are present. No runtime generation-switch or hostile-filesystem certification is claimed.

## Frozen semantic reconstruction

An original cohort/election replay is self-contained and does not normally load raw holder/wallet receipts. Merely repeating that replay would not prove externalized evidence can reproduce its inputs. This study therefore:

1. Keeps the original record, policy, cutoff and hashes, and verifies it with its existing versioned engine.
2. Resolves each referenced receipt by its original identity and requires candidate address, pool, original observation time and holder slot to agree; future or absent receipt identities hold.
3. Validates the raw receipt shape without replacing its archived object, then runs the original holder/wallet analyzer.
4. Requires the regenerated analysis hash to equal the frozen analysis, substitutes it into a copy, and requires the complete candidate and reconstructed record hashes to remain identical.
5. Replays the reconstructed cohort or election with the original engine. Original stored data is never rewritten or reversioned.

The bounded cache holds **regenerated analyses only**, keyed by kind, receipt hash, observation time, candidate address and pool. Every occurrence still checks its frozen cutoff and expected analysis hash. It does not cache plaintext payloads or failed promises. A changed pool cannot reuse an analysis to bypass source-scope validation.

Candidates with no holder/wallet analyses preserve those unknowns. A non-null analysis that lacks a receipt, a missing object, a scope/time conflict or a regeneration mismatch becomes a held reconstructed record. Held records remain in the full denominator; they are never discarded or silently accepted. Original-record corruption fails the operation. Empty cohort/election populations cannot certify this study. The report's status is `held` if any reconstructed record holds; no such holds occurred in the real snapshot.

## Historical result and retained pin

The source remains the **21 October 14:24:50.571Z–14:25:01.519Z archive** used in 113–118. This is every retained cohort/election in that fixed snapshot, not newer live state or a multi-day growth measurement.

| Measurement | Result |
|---|---:|
| Cohorts: v1 / v2 / v4 | 71 / 29 / 83 |
| All cohort records reconstructed and verified | **183 / 183** |
| All election records reconstructed and verified | **9 / 9** |
| Election candidate counts | 341, 342, 342, 346, 348, 358, 363, 364, 442 |
| Candidate occurrences checked across cohorts/elections | 3,429 |
| Occurrences with neither receipt analysis | 2,601, preserved as originally unknown |
| Receipt resolutions / regenerated analyses | **297 / 297** |
| Selected raw payload bytes | 214,758,691 |
| Selected ciphertext bytes read | 39,394,977 |
| Reconstructed records held | 0 |
| Provider requests / fetch attempts / database writes | **0 / 0 / 0** |

There are no retained v3 cohorts in this snapshot. Repeated candidate occurrences and cached analyses are not distinct tokens, source coverage or qualified observations. The 297 selected rows are a subset of the 958 stored references; this study does not newly verify every payload object. Existing full-object checks and all old artifacts remain retained. Session admission decrypts the catalog separately; the selected-ciphertext total excludes catalog reads and metadata/hash work.

Private report: `.tmp/evidence-scratch-replay-20261022-001/replay.json`, file SHA-256 **`58295b32205d066a5e4ba30dfc8a7d11ba689532139e1d14c942bc59a10eec44`**. Its capacity pin is `c019e2049c3457a0c7f68a2eb50e9022956a3232d8755111ea0f8467e0e071b8`, reference pin `b61440eb7a4b5dee5c26ad228c2c841ac596d20cd0f79ec23bce17337f754772`, and source archive pin `a8265797af92c538a481e7074a87c317668da0125e92536732d7b61f1e1e99aa`. Refer to 114 for the separately retained existing key and 118 for unchanged database pins. Hash pins identify bytes relative to retained trust anchors, not authorship or market truth.

The runner blocks JavaScript `fetch`, records zero attempts and uses no local API, provider or Worker runtime. This is an offline Node preservation study, not a latency/CPU/memory/remote metering benchmark or an operating-system network sandbox. No real data/key enters workerd. The new source is committed for review; the private historical inputs/report remain untracked.

## Checks and next implementation

Seven synthetic integration tests pass, covering regenerated v1/v2/v4 cohorts, inline/chunked elections, original hashes, missing-reference and analysis-disagreement holds, wrong pins/keys/co-located keys, catalog/object corruption, end-of-session mutation, no-write connections, output overwrite/nesting refusal, cache scope/time checks and empty-population holds. All 51 archive and seven capacity regressions pass, plus the scoped tooling typecheck. Security CI now includes the new tests/typecheck; no hosted result is claimed. Existing built thesis-only closure, security preflight, original live evidence hashes/foreign keys, credential exclusion and whitespace/syntax checks pass separately. No new application build or application typecheck is claimed for this offline-only slice.

The next storage work should exercise protected-key recovery and an isolated stopped-owner adoption/rollback rehearsal while retaining the original recovery authority. Actual off-device recovery/private metadata encryption, production root/generation/private authorization, a runtime-compatible resolver, later admitted chronological snapshots, newer projection costs and shared account Free/no-spend/read/write/CPU acceptance remain open. Avoid another selected-lookup benchmark without a specific acceptance decision; 117 already demonstrates the raw-resolution serialization/CPU concern.

No live evidence relocation, migration, source collection, restart, remote resource or deploy occurred. Current score-v4, all original model semantics and Free/source/evidence/time/action/election/financial gates remain unchanged. Public/automatic experimental serving and unfinished production functionality remain held behind the thesis-only release setting.

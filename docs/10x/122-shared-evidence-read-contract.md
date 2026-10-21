# Shared evidence reads and encrypted-store parity

22 October 2026 (Australia/Sydney). Starts the runtime-compatible read prerequisite from [121 — encrypted metadata recovery](121-encrypted-metadata-recovery.md). Holder history and acquisition now depend on an explicit bounded read interface with a default D1 implementation. An offline encrypted-storage implementation exercises the same application algorithms. This delivers a read-contract slice, not a complete storage backend, writer migration or operational cutover. F5 remains partial.

## Application contract

`discovery/src/evidence-read-store.ts` defines four methods: `holderIndex`, `walletIndex`, `holderPayload` and `walletPayload`. There is no SQL execution, write, batch, session, network or activation method. The D1 implementation uses the original bound statements through the existing database binding, following [D1 prepared-statement methods](https://developers.cloudflare.com/d1/worker-api/prepared-statements/). No new binding, environment switch, dependency, route, migration or provider is added.

Existing `holderHistoryInputs` and `holderAcquisitionInputs` signatures remain; they select the D1 implementation. New `holderHistoryInputsFromStore` and `holderAcquisitionInputsFromStore` accept the explicit interface for isolated comparison. Their shared selection, parsing, evidence replay, hashes and reports remain the existing application algorithms. Participation and trade-sample reviews consume these same acquisition inputs. The additional cross-address index guards reject a foreign adapter result before payload retrieval.

The contract preserves the original inclusive 24-hour query window, ascending holder time/slot/hash ordering with 97 rows to detect the 96-record limit, first/latest-two selection, and descending wallet time/hash ordering with two rows to detect an ambiguous latest timestamp. It retains the 3,000,000-byte holder and 1,800,000-byte wallet limits, exact hash/address/time/slot identity, missing-evidence errors and every existing completeness/finality/hash/unknown/organic-demand gate. It does not turn sampled acquisition into meaningful 24-hour growth or alter scores/actions.

The Worker-safe implementation contains no Node filesystem, SQLite or offline decryption imports, per [Workers best-practices guidance](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/). An isolated esbuild compilation includes the shared D1 store in the 271-module Discovery Worker graph, retains only its existing `node:crypto` external import and excludes the offline scripts/adapter. This is compilation/import-boundary evidence, not workerd execution, public serving or billed CPU acceptance.

## Offline encrypted-storage implementation

`scripts/lib/evidence-scratch-read-store.ts` implements the same interface inside an admitted `withScratchEvidenceResolver` callback. Index queries read bounded metadata only, with the original selection/order. The resolver's new immutable `describe` method supplies original raw lengths from the fully source-admitted catalog and verifies exact metadata identity; it does not open a payload object or prove organic demand. Missing references remain a hold, never an absence proof.

Before decrypting a selected payload, the adapter requires the complete requested metadata descriptor and maximum byte allowance to match. A mismatch or oversized existing receipt returns no payload; absent/corrupt evidence holds. Recovery still uses the unchanged proof/GCM/gzip/raw/row/source checks and final session file pins. Descriptors are session-scoped and frozen; no plaintext payload cache is added. The interface itself confers no private authorization or root/generation authority. Only the existing fully admitted offline resolver supplies this adapter; it is not imported or selected by the application.

## Reproducible comparison

```powershell
pnpm test:discovery-read-store
pnpm exec tsx scripts/discovery-evidence-read-parity.ts ARCHIVE ARCHIVE_PIN CAPACITY CAPACITY_PIN REFERENCES REFERENCE_PIN SEALED KEY NEW_PRIVATE_OUTPUT
```

All inputs/outputs stay in ignored private `.tmp`, outside Wrangler, with independently retained source pins and a separate existing evidence key. The original complete archive supplies the ordinary D1 baseline. The metadata/reference/sealed population must bind to that same original archive/database. No live database is opened. A new output is exclusively reserved; incomplete directories remain private, and existing/nested artifacts are never overwritten. The CLI prints only aggregate counters and the report hash; the private report contains addresses/cutoffs/hashes, not evidence bodies or session values.

Selection is fixed before outcome inspection: every distinct holder-or-wallet evidence address in the archive, ordered by address, at that address's latest retained receipt timestamp plus five minutes. These are historical comparison cutoffs, not new source observations or qualification windows. A 1,000-address guard rejects overflow rather than selecting the first subset. Each case compares complete normalized input, history, acquisition, participation and trade-report hashes. A rejected case compares the exact error name and error-message hash; identical holds are retained in the denominator, not promoted to successful reviews. Any mismatch prevents a completion report. Shared resolver work remains bounded to 10,000 resolutions / 2 GiB raw, with a 2 MiB report bound and blocked fetch. Original read-only SQL snapshots, total changes and final archive pins are checked before report publication.

The real comparison uses the same 21 October frozen archive as 113–121, the exact capacity/reference files restored by 121, the original sealed objects and the evidence key restored by 120. There are 181 holder addresses and 49 wallet addresses, with **188 distinct addresses in their union**. This denominator covers retained evidence addresses, not the complete token inventory or a prospectively enrolled population.

| Real comparison | Result |
|---|---:|
| Cases / reviewed / rejected | **188 / 188 / 0** |
| Complete input/history/acquisition/participation/trade hash parity | **188 / 188** |
| Selected authenticated payload resolutions | 294 |
| Raw selected payload bytes | 213,448,173 |
| Encrypted selected bytes read | 38,989,034 |
| Plaintext payload cache entries | 0 |
| Provider requests / database writes | **0 / 0** |
| Meaningful 24h growth / organic-demand certification | Held in every case |

Private report `.tmp/evidence-read-parity-20261022-001/read-parity.json` has SHA-256 `e45e5cd00dfe60d94306742590944d44ce6d6faaff3ce29193fd5bf66d0a0a41`. Original source pins remain unchanged: archive `a8265797af92c538a481e7074a87c317668da0125e92536732d7b61f1e1e99aa`, capacity `c019e2049c3457a0c7f68a2eb50e9022956a3232d8755111ea0f8467e0e071b8`, references `b61440eb7a4b5dee5c26ad228c2c841ac596d20cd0f79ec23bce17337f754772`, and sealed pack `ebc5cbf3fbbbdf4ef46d01bf755d059a8fbe033a80b5595c8b5adf388309c76d`. The 121 restored-metadata files remain byte-identical to the originals. This verifies historical application read semantics; it creates no new source observations or model qualification.

All **1,388 Discovery tests across 92 files** pass, including the existing worker public/private route, acquisition, participation, comparison and trading checks. Seven new end-to-end read-store tests and seven each scratch-replay, capacity and encrypted-metadata tests also pass (**1,416 tests total**), plus Discovery/app and scoped scratch-tooling typechecks. New tests exercise exact source inputs/reports, earlier cutoffs, deterministic order, ambiguous latest wallets, 97-record overflow, zero-decryption identity/size/missing-reference holds, foreign adapter indexes, malformed receipt parity, selected ciphertext rejection, wrong pins and exclusive outputs. Synthetic malformed cases explicitly retain identical rejected results rather than reporting a successful review. Security CI now runs the new suite; no hosted result is claimed.

Security preflight, existing built thesis-only closure, all 1,732 preserved live hashes/foreign keys, original/restored artifact pins, actual credential/key exclusion, private ignored/untracked status, syntax and whitespace checks pass separately. The isolated Worker build tests its source dependency graph; no new frontend build, workerd execution, live restart or operational adoption is claimed. No raw payload or secret enters committed files, public assets or CLI output.

## Remaining compatible-backend work

This slice covers history/acquisition reads and the downstream participation/trade algorithms. Direct evidence reads in wallet planning, wallet cycles and protected raw-evidence routes still use D1. Existing evidence writers/transactions and collection remain unchanged. The stripped capacity schema still cannot be adopted as an application store, and this adapter does not make it writable or runtime-compatible as a whole.

Next extend the explicit contract to the remaining immutable read consumers, then design compatible append/write behavior with original transaction/allowance/failure semantics before a fenced stopped-owner adoption/rollback rehearsal. Keep the old store authoritative, reject active/unknown owners and stale generations, never reactivate historical sessions/leases, and require exact pre/post replay plus rollback. A bookkeeping-only stopped flag remains insufficient.

Independent off-device data/key/wrapping-key custody, actual loss recovery, production private/root/generation authorization, ordinary later archives/newer projection costs and shared account Free/no-spend/read/write/CPU acceptance remain open. Same-machine read parity does not establish them. All original artifacts, v4, provider Free limits and source/evidence/time/action/election/financial/release gates remain; production stays thesis-only. No live relocation, migration, collection, quota reset, deletion, restart, upload, spending or deploy.

# Wallet and marketplace compatibility evidence

This matrix describes local software coverage. **No physical wallet or marketplace execution integration is verified.** Candidate custody and provider choices remain open. Exact machine-readable row validation lives in `platform/compatibility/matrix.mjs`; dates, versions, feature and source pins are mandatory for a passing local row. Missing, future-dated, stale or incomplete configuration evidence cannot produce a local pass. Source pins identify assertions, not reviewer or provider authority.

## Feature matrix

| Configuration / feature | Local evidence | Status | Limit |
|---|---|---|---|
| Synthetic Wallet Standard provider â€” discovery/message authentication | Chromium 156.0.8078.4 / Windows 11 Enterprise 10.0.26200; fixture 1.0.0; 48 boundary groups at four widths | passed-local; physical support unverified | Disposable local message-authentication keys only |
| Synthetic recorded wallet capability adapter â€” legacy unsigned packet | B15 `packetRecording` vector and existing `validatePacket` verifier; B18 focused tests | passed-local | Preparation verification only; no signer or broadcaster |
| Synthetic recorded wallet capability adapter â€” v0 unsigned packet | Explicit pure decoder-format variation of the same B15 unsigned bytes, with empty lookup vector | passed-local | This is newly derived local format coverage, not a frozen physical-wallet or program-execution result |
| Synthetic adapter without required version, account capacity, size or expected signer display | Capability-negative tests | incompatible for unsigned-packet feature | Other features retain their own independent status |
| Any physical wallet â€” transaction signing and return | No performed physical-device evidence | manual-required | Exact device/OS/browser/wallet versions and reviewed message required |
| Candidate Core asset and collection policy â€” direct private transfer | Existing historical protocol evidence is separately scoped; no physical marketplace run | manual-required | No assumption about plugins, escrow or current-owner claim authority |
| Unselected venue â€” listing | No execution evidence | manual-required | No native listing action |
| Unselected venue â€” buy/fill | No execution evidence | manual-required | No native purchase action |
| Unselected venue â€” cancellation | No execution evidence | manual-required | No native cancellation action |
| Unselected venue â€” royalties | Target/enforcement/realized income unknown | untested | Unknown is null, not zero or guaranteed income |
| Unselected venue â€” metadata refresh visibility | No observed venue refresh | manual-required | App rehearsal does not prove venue cache behavior |

Recorded 7 November 2026 UTC: full browser suite passed, including 48 new wallet boundary groups and 12 screenshots; site tests 30/30 and build passed. Exact versions, source/log/screenshot hashes and commands are retained in `runs/2026-11-06-overnight/B18-browser.json`. The 14-row canonical matrix is `runs/2026-11-06-overnight/B18-matrix.json`, pinned to source commit `7deb2628c0934b469d113d089dc311240ab834cf` and exact source bytes. Do not turn the first row into a generic wallet-brand support claim. The physical checklist remains unfilled even when every local browser case passes.

## Packet validation scope

`inspectUnsignedWalletPacket` captures bounded own-data input before asynchronous hashing. It independently recomputes the canonical plan hash, binds the expected intent and attempt, restricts the network to the synthetic local genesis, and calls B15's existing packet verifier. That verifier checks message hash, recent-blockhash lifetime, exact signer order, account privileges, ordered instructions and lookup evidence. The capability check adds transaction version, final serialized size, account count and expected signer display.

Results always retain `physicalSigningVerified:false`, `financialExecution:false` and `isAuthorization:false`. No transaction-sign, send, broadcast or retry API is exported. Unsupported capabilities affect only the unsigned-packet feature. Unknown outcomes elsewhere retain their original operation/attempt and permit reconciliation only.

Pinned sources for this coverage:

| Source | Commit | SHA-256 |
|---|---|---|
| `platform/storage/recorded-attempt-preparations.fixtures.mjs` | `d16a1540dbaf22eb3f82d2209eb863167e037357` | `44770dce50fe14df6fc3ce62a2edbd56a2a709dd5819b81f8bcf80ab09dc356d` |
| `platform/transactions/packets.mjs` | `d7b2d301500c48f2cb9f46d124c249f27b0e61a7` | `ceffbe84cead16c0a3b2b9896a3c5c323ccda32a3f9377eae21884258e7b9159` |
| `platform/transactions/recovery-read.fixtures.mjs` | `28d5ea91d1878e011630097fc0b0584fc6d29287` | `ec59b6a3ba3e30be06254853b54802adc515efe08eb5a0fd3afe60c2843a89b4` |

Each named Git blob was compared with the pinned bytes. Focused acceptance: `node --test platform/compatibility/compatibility.test.mjs`, eight passing tests at the initial B18 checkpoint; exact final results are recorded in the integration evidence. These tests include canonical plan mismatch, mid-await input mutation, unsupported capability isolation, packet substitution, stale evidence, source pin checks and marketplace unknowns.

## Read-only marketplace view

`describeMarketplaceFixture` separates asset identity, dated owner observation, listing state, price age, royalty target/recipient/enforcement and remaining Vault value. Every input is explicitly a synthetic read-only fixture. Unknowns stay null. Stale price is flagged; it never creates a native trade action. A recorded owner is not current claim authority, a listing is not an integration, and royalty basis points are not realized income.

Required later evidence is listed in `platform/compatibility/physical-device-checklist.md`: private transfer, real listing/buy/cancel, escrow custody, post-sale claim authority, royalty realization, metadata refresh and exact asset/collection permission compatibility. Existing Core burn and authority conflicts remain unresolved. No new authority probes, physical signatures, remote mutations or funded tests were performed for B18.

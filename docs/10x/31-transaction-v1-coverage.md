# Version-aware Solana transaction coverage

21 October 2026 (Australia/Sydney). Advances PRD §§4, 14.2 and work packages P3/P6 in the [task map](19-prd-task-map.md). Free services, local runtime and every existing evidence gate remain required. No deployment, paid resource, signing, transaction broadcast, voting or reward authority was added.

## What changed

The previous checkpoint observed `unsupported_transaction_version` in wallet collection. Both read adapters explicitly requested `maxSupportedTransactionVersion: 0`. Solana now documents legacy, v0 and active v1 transactions, with v1 resource configuration embedded in the message and no address lookup tables. Opting in to v1 is required to read that format. See the [official transaction format documentation](https://solana.com/docs/core/transactions/versioned-transactions) and the pinned [Agave v4.2.2 RPC JSON types](https://raw.githubusercontent.com/anza-xyz/agave/v4.2.2/transaction-status-client-types/src/lib.rs).

Creation/graduation and wallet readers now request version 1 with the same finalized commitment. The shared schema retains `transactionConfig` in new v1 evidence: nullable `priorityFee`, `computeUnitLimit`, `loadedAccountsDataSizeLimit` and `heapSize`. Missing or unknown config fields, version/config disagreement, malformed signer headers and v1 lookup references/loaded addresses fail closed. Priority fees must be safe integers and resource limits must fit unsigned 32-bit values; larger/unsupported representations remain gaps rather than rounded values. This is a bounded JSON reader, not a wire-format implementation or certification of every possible v1 transaction.

Legacy/v0 normalization does not gain new fields. Existing evidence hashes and observation times remain unchanged. The same canonical Pump accounts, transfer reconciliation, token ownership, signer, signature, slot and funding time/order checks apply to v1. Actual network fees continue to use `meta.fee`; message priority settings are not Pump/PumpSwap trading revenue and are not inferred from ComputeBudget instructions.

The funding-only continuation previously let an unsupported transaction abort the whole turn. It now saves that exact signature as `unsupported` in the retained funding checkpoint. Other windows in the turn can advance; later reads restore the marker without purchasing the same terminal body again. Coverage stays partial and eligibility stays blocked. Cache corruption, identity/slot mismatch, provider outage and rate limiting still fail closed; transient failures are not stored as terminal unsupported evidence. Discovery's migration inbox similarly records unsupported layouts and continues other work; archival null responses remain retryable.

## Budgets and operation

No new calls, retries, providers, dependencies, migrations, timers or configuration variables are introduced. Existing RPC admission, wallet/catch-up ceilings, per-turn bounds, leases, cooldowns, shared backoff and public cached-only reads remain intact. The running local worker reloads the source change; the existing automated collector continues within its allowances.

Previously saved unsupported funding markers and processed migration inbox entries are **not automatically reset**. Frozen snapshots are not enriched or re-timestamped. A future recovery lane needs an explicit reader-version transition, exact-anchor/hash verification, bounded admission and recorded live evidence before old gaps can be resolved. Unknown future transaction versions remain unsupported. Unsupported Pump instruction/fee routes remain unsupported independently of the envelope version.

## Validation and observed limits

- The final full discovery suite passed **325 tests across 33 files**, including all new funding/inbox regressions. The focused transaction, service and funding-continuation run also passed all 60 tests.
- New synthetic RPC regressions cover strict v1 config, defaults, numeric precision, unknown fields/versions, lookup rejection, signer consistency, signature mismatch, pinned historical hashes, verified Pump trades, and directly signed funding versus unsigned/CPI outflows. Synthetic inputs are never served as live chain evidence.
- Funding continuation regressions retain unsupported version/layout markers once, advance other windows, prevent repeat body reads, preserve candidate snapshots, and distinguish transient 429 errors. Inbox coverage distinguishes terminal layouts from retryable archival misses.
- Discovery typecheck and app build/performance budget passed. Home startup stayed **233.9 KiB gzip**. Generated OpenAPI includes the supported envelope/config representation; Zod runtime checks remain authoritative for cross-field constraints.
- Local cached checks replayed **four wallet snapshots, three backing records and three election rehearsals**, using zero provider calls. All policy gates and quota ceilings remained unchanged. Preview checks denied 15 private-file requests and passed 10 operator origin/body checks; signed actions still require a session.
- Timer and independent watchdog were recent and healthy, with no restart recommended. At the coverage check there were **0 eligible of the target 10**, two direct-funding plans and nine source-limited plans; wallet usage was **621/800** for the UTC day. These are point-in-time observations, not claims of improved eligibility or validated investment selection.
- Read-only local cache inspection found **97 v0 and 251 legacy bodies, no v1 bodies**. Therefore v1 decoding is tested against the pinned official JSON layout and synthetic adversarial cases; a retained live v1 fixture and its replay remain outstanding. No unmetered RPC requests were made to manufacture a coverage result.

Commands from the repository root, all local:

```powershell
pnpm --dir discovery test
pnpm --dir discovery typecheck
pnpm --dir app build
pnpm exec tsx scripts/generate-discovery-openapi.ts
pnpm exec tsx scripts/check-discovery-wallet-plan.ts
pnpm exec tsx scripts/check-backing-local.ts
pnpm exec tsx scripts/check-discovery-operations.ts
node scripts/check-tenx-security-local.mjs
git diff --check
```

Next: retain a real v1 response through normal metered collection, certify that replay, then implement a bounded version-aware recovery lane for old unsupported markers. Ten eligible recent tokens, complete historical funding, independently verified backing finality/USD and the remaining PRD content/reward proofs are still open. The [provider credential rotation follow-up](29-security-review.md) also remains outstanding.

# Anchored pre-buy funding history

20 October 2026, Australia/Sydney. Local runtime and local D1 only; free public Solana RPC. No deployment, remote migration, paid plan or transaction signing/broadcast. [Review the live sample](https://app-local.10x.meme/token/solana/3mmewUcttCpSJwVx9BcquZNmwEfJs4nZpKfTDXdipump#wallet-analysis).

## Change and evidence

Previously, wallet collection started at the most recent 20 signature references and inspected one older transaction. Busy post-launch activity could hide pre-buy funding. New collection anchors the first page immediately before a verified sampled buy, or the signed creation transaction for a creation wallet, and pages backward over the preceding hour. Subsequent pages continue from the last returned signature. It never guesses order between separate transactions in the same slot.

Each wallet/anchor has hash-checked local progress. Pages and examined transactions are saved as they succeed, so an interrupted request resumes without restarting the scan. Finalized transaction bodies reuse the existing immutable cache. Work rotates through pending wallets; permanent limits and provider omissions remain visible. A new anchor gets separate progress; old evidence and frozen daily baselines are preserved.

The real replay fixture `discovery/fixtures/recorded/funding-evidence.json` shows:

- Seven verified early buyers remain verified.
- A direct signed funding transaction at slot **458979238**, two seconds before the sampled buys, funded six of those buyers from `Fy9bdZdEJ6wRoFJad6CpZ3hxcQxrbY4kyJf9yfMebKbQ`.
- A separate direct transfer to the signed creation wallet at slot **458977984** preceded creation. It has a different observed source.
- Six buyer windows reach a dated older boundary and have every returned successful finalized in-window transaction decoded.
- The creation wallet's provider history ends before a dated one-hour boundary. Its coverage stays **partial**, even though the observed funding transfer is verified.

This does not establish that the six buyers share a controller, that their funder is the developer, or that they belong to a bundle. Common sponsors/exchanges remain possible. A separate synthetic regression verifies the case where one direct funder precedes both signed creation and another buyer; that signal is explicitly a heuristic. No real common dev/buyer funder is claimed for this fixture.

## Bounds and gaps

| Limit | Local behavior |
|---|---|
| Wallet source allowance | Unchanged: 800 calls/day **within** the 5,000-call global free RPC cap |
| Total per wallet-analysis tick | Unchanged: at most 18 RPC requests, under existing quota, lease, pause and backoff controls |
| Anchored wallets per token | Up to eight, signed creation roles first, then deterministic sampled buyers |
| Progress per tick | At most three pending wallets; up to one page and three transaction reads each, subject to remaining RPC budget |
| Paging per wallet/anchor | Up to three pages of 50 references |
| Decoded transactions per wallet/anchor | Up to 12, processed nearest the anchor first |
| Replay snapshot | Up to 64 transaction records, 900 KB of normalized transaction bodies; existing 1.8 MB total evidence cap remains |
| Recent pool enrichment | Two transaction samples per tick, leaving room for anchored funding work |

“Returned window examined” requires a dated reference older than the one-hour boundary and every returned successful finalized in-window reference available and decoded. This describes returned provider data, not exhaustive chain history. Empty/short archival responses do not establish wallet birth or prove absence of funding. Unknown timestamps, missing/unsupported bodies, nonfinalized references, pending work and page/transaction/wallet/snapshot limits remain explicit gaps. Failed transactions are not funding evidence. Same-slot transfers in different transactions do not establish pre-buy order.

Only top-level directly signed System transfers are classified as funding links. Rent/refunds, swaps, arbitrary CPI transfers and token transfers are not inferred to be SOL wallet funding. Current supply exposure still requires a fresh reconciled holder inventory. Common-funder and connected-supply counts are observed lower bounds. Lifetime history, beneficial ownership, multi-hop ancestry, cross-token P&L, actual bundle membership and scam verdicts remain unknown.

The UI shows each wallet's anchor, window start, page/reference counts, examined transaction count and precise gaps. Funding transfers link both source and recipient accounts and their transaction evidence. `wallet-input-v2` / `wallet-signals-v2` retain the new coverage; v1 fixtures still replay unchanged. New partial funding evidence cannot clear the local wallet eligibility gate. Research snapshots also retain tracked/examined window counts so sampling breadth can be compared with later outcomes. Proposed policy changes remain inactive.

## Operation and validation

Migration `0007_funding_history.sql` was applied to the isolated local discovery database only. No binding, credentials, relay allowlist or paid provider was added. Existing `TENX_WALLET_ANALYSIS_ENABLED` and `TENX_WALLET_RPC_DAILY_LIMIT` toggles still control the loop. The existing supervisor/timer automatically runs the updated Worker; source refresh was resumed after migration.

Three bounded live verification ticks for the recorded token used 9, 7 and 5 RPC requests, respectively, demonstrating cached reuse and progress across ticks. These are observed call counts, not a freshness promise for the whole market. Local daily request caps remain hard limits.

Changed files: `funding-history.ts` and tests; migration 0007; wallet models, collector, decoder and replay analysis; local eligibility coverage gate; research coverage fields; token wallet/status UI; generated OpenAPI; real funding fixture and these notes. Original proof normalization and immutable snapshots are unchanged.

Exact validation commands:

```powershell
pnpm --dir discovery exec wrangler d1 migrations apply TENX_DB --local --config wrangler.local.jsonc --persist-to .wrangler/local
pnpm --dir discovery typecheck
pnpm --dir discovery test
pnpm --dir app typecheck
pnpm --dir app test
pnpm --dir app build
pnpm exec tsx scripts/generate-discovery-openapi.ts
pnpm exec tsx scripts/check-discovery-local.ts
git diff --check
```

Tests cover anchored `before` cursors, resumable paging and transaction queues, interruption recovery, limits, fair wallet rotation, missing/unsupported data, null dates, empty archival responses, cursor/hash integrity, verified anchor matching, observed common funders and exact real replay. Broader app tests, build/performance and cached evidence smoke checks are included. Source backoff and global caps remain covered by the existing service tests.

Validation: **96 discovery tests across nine files** and **773 app tests across 128 files** passed, along with both TypeScript checks and the local app build/performance budget. The cached smoke check replayed three wallet snapshots and retained proof/holder snapshots without external provider requests. The browser preview was inspected for the coverage table, visible creation-history gap, linked funding transfers and SOL amounts. These results do not establish a safe token or an exhaustive wallet history.

Next: collect outcomes with their coverage metrics and evaluate whether selective additional history or a bounded second hop materially adds evidence within the free cap. Broader scans need measured benefit; no paid indexer or automatic wallet ban is implied.

Primary references: [Solana signature paging and `before` semantics](https://solana.com/docs/rpc/http/getsignaturesforaddress), [transaction JSON structures](https://solana.com/docs/rpc/json-structures), and [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/). These establish the API/data handling; the sample findings above come from retained finalized RPC evidence, not third-party wallet labels.

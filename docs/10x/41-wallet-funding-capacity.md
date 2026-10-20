# Wider wallet funding collection — unchanged evidence gates

21 October 2026 (Australia/Sydney). Continues PRD §§4, 14.2, 17.1 and task P3 toward ten eligible tokens created within 24 hours. Free services, existing local runtime and no deployment. Product documents supply requirements; no permission for paid services, signing or financial execution is inferred.

## Finding and implementation

At the initial cached observation there were zero eligible tokens and twelve current wallet plans, all source-limited. Three samples had a `funding_wallet_limit` flag despite only eleven or twelve retained transaction bodies, well below the 64-record/900 KB body bounds. The collector could observe more buyers than its eight direct-funding windows could cover. Replay established that one sample had nine buyers and was within the existing twenty-wallet output capacity; two samples had twenty-two buyers and remained outside that capacity.

New **wallet-input-v5 / wallet-signals-v5** evidence can collect up to **twenty direct funding wallets**, matching the existing wallet-output bound. This increases collection capacity; it does not lower an evidence requirement. The collector still retains every known sampled buyer, verifies exact signed creation roles, and requires all corresponding pre-buy windows. V5 explicitly marks omitted buyers or signed creation wallets as blocking even if an input caller clears the capacity flag. Fresh ordinary snapshots use v5 automatically; legacy maintenance never downgrades them.

Read-only planning can prepare a capacity-limited v4 sample for wider collection by replaying its original evidence, retaining its known anchors and deriving missing anchors from verified trades/creation roles. More-than-twenty-wallet samples stay blocked. Checkpoint anchors are schema-normalized before comparison; the historical hash function and key order are unchanged. Wider direct evidence can change a funder's earliest relevant outflow, so v5 upstream scopes are rebuilt against exact verified outflow instructions. An older second-hop scan is reusable only for that same anchor; unknown upstream coverage remains explicit.

Funding continuations advance checkpoints and measured work only. They do not rewrite the original candidate evidence, observations, holder snapshots, wallet profiles, research baselines or eligibility. Completed checkpoints still require a subsequent fresh full wallet snapshot and every other gate. Both direct continuations and source-reader recovery support the v5 scope; direct work remains ahead of second-hop enrichment. No new scheduler, toggle or database migration is needed.

## Preserved limits and compatibility

- Original v1–v4 input/result schemas, normalized fields and replay hashes remain unchanged. Only v5 admits more than eight direct windows. Original recorded wallet fixtures continue to replay.
- Required creation/graduation proofs, 24-hour age, market-cap/liquidity floors, holder/concentration/permission checks, minimum sampled buyers, exposure thresholds and all freshness gates are unchanged. The active `DEFAULT_POLICY` file is unchanged.
- Each funding window still requires the full preceding **one hour**, an actual older boundary, finalized/timed references and supported bodies. Empty archive history is not a pass.
- Per-window bounds remain **three pages / fifty references per page / twelve bodies**. Global evidence remains **64 records / 250 KB per body / 900 KB combined bodies / 1.8 MB final evidence**, with unchanged output and second-hop limits. Cached recovery retains its 96-lookup ceiling.
- Collection remains at most **18 RPC calls per turn**, wallet **800/day** inside global RPC **5,000/day**. Market/artwork/catch-up caps and reader-recovery reservations are unchanged. Pause, leases, pacing and shared backoff continue to apply.
- Existing endpoints remain; OpenAPI still has 77 paths. Wallet plans disclose the direct-window capacity and additional required windows. Discover explains that wider planning is not completed evidence.

## Actual local result

`scripts/advance-wallet-coverage-local.ts` uses only the existing loopback operator API and reads its token in memory. It bounds one manual exercise to six turns and at most 36 source calls, checking current contender status, policy, capabilities and conservative daily headroom before each turn. `--new-snapshot-one-turn` instead selects one new contender with an 18-call/one-turn ceiling. It never resets counters, bypasses source backoff or changes a policy. It stops on a blocked plan, waiting/failure or its budget/turn ceiling. Receipts are retained in ignored `.tmp/wallet-scope-<uuid>.json`, with `.tmp/wallet-scope-local.json` pointing to the latest result. The initial capacity exercise was also retained as `.tmp/wallet-scope-capacity-exercise.json`.

At **21 October 2026, 07:08:39 AEDT** (`2026-10-20T20:08:39.226Z`):

| Observation | Before | After |
|---|---:|---:|
| Eligible tokens | 0 / 10 | **0 / 10** |
| AOP direct windows examined | 3 / 9 | **4 / 9** |
| Wallet daily RPC usage | 722 / 800 | **728 / 800** |
| Calls made by this exercise | — | **6** |
| Candidate evidence hash/time | Original v4 | **Unchanged** |

The token is `8ikdGCtt5gcc3Lf9eQrwMgQqRmg24Py5abrzDovopump`. A newly read window exposed more than twelve in-window transactions, so the collector stopped as `source_limited`. Fourteen bodies remained pending across the scope. It did not purchase an oversized window or refresh the stale wallet snapshot. One additional window is completed; there is no new eligible token and no claim that ten qualifying tokens are currently available.

A new contender appeared during validation. At **07:14:23 AEDT**, the separate one-turn exercise collected IOF (`FdYcdzrJjMq5EmfTHFxmtb8WS48QzQQbb65zJJZtpump`) using **14 calls**, successfully saving the first observed live v5 snapshot. Its six required direct windows remain partial; oversized windows block completion. Independent cached replay verified hash `818ac096d045f1a4f350640d4d4648e65d124f71c9f8bbac442081493de231e4`. Combined manual work used **20 calls**, with wallet usage **742/800** and eligibility still **0/10**. Further futile reads were not forced.

Two exact already-cached public-chain inputs are retained as regression fixtures: the nine-buyer sample and a twenty-two-buyer sample. Their original SHA-256 hashes are respectively `92dd291ce33f6c0cee03fd0642280e93ee00f50c278a02a0dd1e3a04e2ee0d7c` and `4609a7100eb4ca281b3a52923a1659064b3f358e3bd24a5b14a560a3234d57bc`. No provider request was needed to capture them. Synthetic tests show ten required windows completing in four bounded continuations, with the original candidate snapshot and eligibility unchanged; synthetic outcomes are never seeded as live evidence.

## Validation and remaining work

**509 discovery tests across 40 files passed**, including eleven new tests covering recorded hashes, exact anchors/upstream re-anchoring, missing buyers/creators, output overflow, unchanged old schemas, missing archive boundaries, per-window/sample bounds, quota failure before source access, immutable candidate timestamps, tampered replay and prevention of v5 downgrades. Discovery typecheck and app build/typecheck pass; home startup remains 233.9 KiB gzip. Local checks replayed four prior wallet snapshots plus the new live v5 snapshot and three election rehearsals. Timer/watchdog were healthy. Security checks denied fifteen private-file requests and passed ten operator checks. These verification checks made zero provider requests. Browser review verified the wider-capacity disclosure and remaining-work view through the existing tunnel, without entering an operator or wallet credential.

```powershell
pnpm --dir discovery test
pnpm --dir discovery typecheck
pnpm --dir app build
pnpm exec tsx scripts/generate-discovery-openapi.ts
pnpm exec tsx scripts/check-discovery-wallet-plan.ts
pnpm exec tsx scripts/check-discovery-operations.ts
node scripts/check-tenx-security-local.mjs
# Optional quota-consuming exercise, bounded as documented:
pnpm exec tsx scripts/advance-wallet-coverage-local.ts
git diff --check
```

The wider collector runs through the existing local timer. New finishable samples can advance without an operator; known archive, transaction-count and output-limit failures remain blocked rather than repeatedly retried. Next work is additional finishable fresh contenders and certified free-source/archive coverage, with measured gains and the same gates. Full wallet completeness, ten eligible tokens, production voting/rewards, provider credential rotation and deployment remain outstanding.

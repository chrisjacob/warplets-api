# Retained cutoff evidence and historical price references

Local PRD §§5.2–5.3 / P6 continuation, 20 October 2026. New backing rehearsals preserve committed candidate updates through cutoff and retain bounded pre-trade provider price references. All outcomes remain withheld, winners null, and votes/rewards disabled. Existing discovery gates and provider allowances are unchanged.

## Cutoff evidence

Migration `0020_backing_cutoff_history.sql` adds a prospective, append-only candidate journal; `0021_backing_candidate_scope_guard.sql` also detects contenders leaving the live inventory. SQLite triggers capture the **effective merged candidate row**, in the same transaction as its update, covering discovery saves, market refreshes, holder/risk updates, wallet collection and cached wallet replay. No additional provider requests are made. The database records its local write timestamp with millisecond precision, separately from provider fetch time.

Only the twenty frozen contenders in a new open rehearsal are captured. Updates after cutoff, fixtures and candidates outside that opening are ignored. Cutoff includes updates recorded exactly at the end boundary; trade inclusion remains `[start,end)`. Byte-identical consecutive updates are deduplicated. The journal stops at 200 updates or 600 KB of payloads per run. If an update would exceed either bound, collection continues and a sticky history-limited flag holds **all** closing gates. Candidate deletion, address change or departure from live mode during the window also marks incomplete history. There is no automatic purge; total local retention and any future remote storage budget remain outstanding.

Opening admission now checks that selected candidate rows still match the read snapshot, alongside the existing identity-audit watermark, within the atomic admission transaction. A race fails admission instead of silently freezing stale inputs. The baseline availability time is recorded by the database at admission, rather than backdated to the JavaScript request timestamp.

At settlement, the latest retained candidate update at/before cutoff replaces its opening baseline. A contender with no update keeps its opening snapshot and must still pass every freshness and evidence gate at cutoff. Source timestamps must also be no later than the snapshot's recorded availability. Later cleanup or refresh cannot replace a failing historical snapshot. Selected cutoff timestamps, sequence IDs and candidate hashes are frozen with the exact closing candidates; replay validates them without consulting the current candidate table.

This establishes bounded local observation history, not exhaustive onchain safety history, a trusted timestamp authority or a finalized-slot certificate. SQLite timestamps a write inside its transaction; it can precede actual commit and is not an independent receipt of availability at a subsecond trade/cutoff boundary. That limitation is included in per-trade reference gaps. An updated snapshot can still contain stale individual components; the existing gates detect that. A source timestamp cannot prove when the source originally published data. Full election indexing, membership revisions beyond the existing signed-link/unlink evidence and chain rollback handling remain incomplete.

## Price references, explicitly unverified

The current free market adapters retain provider-reported token USD prices and fetch times. They do not retain a publication timestamp or an independently verified historical USD oracle. These inputs cannot honestly produce verified execution USD valuations.

For each decoded trade in a new rehearsal, the diagnostic selects the latest retained candidate price snapshot whose local database write was recorded **before or at the trade's block timestamp**. Its source fetch must be no later than that write; any supplied publication time must also precede it. The fetch/publication age must be at most 180 seconds at the trade. No price recorded after the trade or later enrichment is used. The selection uses the candidate's pool/mint market mapping already checked by the market adapter; it makes no new lookup.

The reference is measured base units × captured token USD price ÷ 10^decimals, rounded down to integer micro-USD. Decimals must agree across the captured transaction's token-balance metadata for that mint. They are RPC-provided balance metadata, not a new independent mint-account certification. Exact BigInt arithmetic handles decimal/scientific notation on the captured JSON number; it cannot restore precision lost before capture. Extreme outputs beyond the retained integer bound become unavailable. Missing/zero prices, stale/future availability and missing/conflicting decimals remain visible gaps.

Every entry has `verified_usd_micros: null`. A usable value is labelled `provider_reference_only`, with its source, fetch/local availability, journal sequence, decimals and gaps. Unknown publication time is explicitly reported. Missing references remain null. A limited journal adds an incomplete-price-history gap. These estimates never replace the existing explicit hypothetical USD/SOL assumptions, change projections, approve D07, or generate vote credit. Zero verified USD trades is shown in public coverage.

## Versioning, review and bounds

New openings opt into `candidate-journal-v1` and evaluate with `backing-experiment-v2`. Optional fields have no schema defaults: old openings/evidence/results retain their byte representation and original `backing-experiment-v1` replay. Already frozen records are never backfilled or rewritten.

`/backing` shows cutoff coverage, selected updated snapshot counts and available/missing reference counts. Full per-trade references, exact prices/provenance and private membership remain operator-only in the existing replay/download endpoint and Admin lab. Public reads check stored hashes without running the decoder per visitor. The generated OpenAPI matches the strict runtime schemas.

The existing one-open-window/twenty-openings-per-day limits and 650/950/250 KB opening/evidence/result bounds still apply. The separate journal has its own 600 KB cap. Oversized final evidence fails settlement with a visible error rather than dropping required candidates. D1 transaction behavior follows [Cloudflare's batch documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch); migration uses [Wrangler's local D1 commands](https://developers.cloudflare.com/workers/wrangler/commands/). No new runtime configuration or paid service is required.

## Validation

The discovery suite passes **267 tests across 28 files**, including 27 backing tests. New cases cover late cleanup after a failing cutoff snapshot, merged source-write capture, rollback, append-only history, cutoff equality, no-op/fixture/out-of-scope filtering, row/byte bounds, deletion/scope departure, candidate admission races, future-dated risk evidence, pre-trade price selection, stale/future/missing prices, conflicting decimals, extreme/scientific-notation arithmetic, provenance tampering and legacy field compatibility. Positive trading cases use isolated synthetic fixtures; no synthetic wallet or trade is written to the working database.

Both migrations applied locally. Discovery/app typechecks and the app build/performance budget passed. Working-data run `bfdef4ba-a573-4e7f-b35d-f0f3ee77738c` opened at 11:34:09.566 UTC and froze automatically after its fixed 11:40:09.566 deadline. It retained twenty opening baselines and nineteen baseline price observations, with **zero in-window candidate updates, zero eligible contenders, zero signed wallets and zero decoded trades**. It therefore tests automatic settlement/baseline retention, not successful live update or price coverage. The new v2 replay and older v1 working-data replay both independently matched their retained hashes. Protected evidence still returned 401 without the operator token. No synthetic wallets/trades or forced refreshes were added to this database.

The HTTPS preview was visually checked and a screenshot saved at `.tmp/backing-cutoff-history.png`. The independent local timer/watchdog remains recent. An intermediate review reported degraded wallet-source coverage (`wallets_source_issue`); it recovered without intervention, and the final 11:44:32 UTC watchdog review was healthy with no issues or restart recommendation. Existing source backoff/quotas were preserved. The three older discovery rehearsal replays still verified, and the checks made zero provider requests. No new environment variables or configuration toggles were introduced; journal mode is frozen automatically in new openings, while old records retain their old mode.

```powershell
pnpm --dir discovery typecheck
pnpm --dir discovery test
pnpm --dir app typecheck
pnpm --dir app build
pnpm exec tsx scripts/generate-discovery-openapi.ts
# From discovery/; local resources only:
pnpm exec wrangler d1 migrations apply TENX_DB --local --config wrangler.local.jsonc --persist-to .wrangler/local
# From repository root:
pnpm exec tsx scripts/check-backing-local.ts --open
pnpm exec tsx scripts/check-backing-local.ts
pnpm exec tsx scripts/check-discovery-operations.ts
git diff --check
```

Next P6 work: establish supported-window collection completeness and an independent finalized-slot watermark, certify historical USD valuation, retain stronger membership/funding revision evidence, then compare D07 hypotheses on frozen inputs. The ten-eligible-recent-token discovery target remains unmet. No deployment, signing authority, wallet transaction, live vote, reward, provider-limit increase or policy relaxation is introduced by this checkpoint.

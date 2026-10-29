# Evidence and daily operations

This is local, non-financial infrastructure. Production participation rules and real-wallet QA are still unapproved. No deployment, cron registration, remote binding, key reuse or provider allowance is implied.

## Local startup

From the repository root, install the frozen workspace lockfile. Apply `pnpm --dir meme db:migrate`, then `pnpm --dir meme operator init`. Start the Worker with `pnpm --dir meme dev:worker`, the UI with `pnpm --dir meme dev`, and the local job runner in another terminal:

```
pnpm --dir meme operator run <absolute-path-to-authoritative-warplets.sqlite>
```

Omit the SQLite argument to run jobs without automatic ownership freezes. `operator tick` performs one bounded step. Stop the runner with Ctrl+C. Its state is in the isolated local Meme database, so restarting resumes unfinished work. Existing previews and databases in other worktrees are untouched. The scheduled Worker handler is disabled by default and there are no Cron Triggers or remote database IDs in configuration.

## Operator plans and ownership

An operator still reviews candidates, seals the attribute cycle, and selects or skips. Queue a preparation request at `/api/meme/operator/operations/prepare` with `{at,round}`; `round` is the existing create-round payload. The runner prepares it when due, freezes from the authoritative SQLite source before opening, advances open/closed states, builds score snapshots, and settles closed rounds when evidence permits. It never chooses candidates or launches tokens. A missed/stale freeze leaves the round unavailable. It never substitutes a late ownership observation.

`operator ownership-freeze <sqlite> <round-id>` reads and submits one consistent read-only SQLite transaction directly. It joins `warplet_market_state` ownership to `warplets_metadata`, validates all 10,000 token IDs, real `7X` attribute values, addresses, and timestamps, and hashes the source records. It does not use Network membership, preferred-FID or airdrop indexes. Ownership observations older than 24 hours block the import. This is the existing source's freshness rule, not a promise that every NFT was checked at the exact cutoff; approval of that policy remains required.

Jobs have immutable identities/payloads, persisted progress, expiring leases, fenced completion, bounded retries and safe error messages. Inspect authenticated `GET /api/meme/operator/operations/jobs`. Correct a blocked prerequisite, then POST `/operations/retry` with `{id}`. A lost response may repeat a step, but cannot duplicate its committed data. Preparation plans must be queued sufficiently before opening. Concurrent conflicting operator preparation remains an explicit error.

## History and acquisition prices

The Helius adapter queries finalized full transactions in ascending order, including `tokenAccounts:'all'`, and persists every page, cursor, receipt hash and chained root before moving forward. `/sources/start` accepts `{campaignId,wallet,throughAt}`; collection always starts at actual campaign launch. `/sources/step` accepts `{id}` and collects at most 20 receipts. Repeat to the terminal cursor. A cutoff must be at least two minutes old. Source metadata, failed/unsupported receipts, cursor loops, conflicting duplicates, missing owner metadata and incomplete ranges block coverage. Legacy/v0 receipts are supported; newer versions and ancient pre-owner-metadata history require additional integration, not assumed completeness.

The independent price adapter uses the historical Pyth Hermes endpoint and an explicitly approved mint/feed/decimals/time/confidence mapping. `/sources/price` accepts `{paymentMint,at}`. It persists the oracle response and observation binding, with integer USD-micro arithmetic. Its trust model is `oracle-https`: the adapter authenticates the endpoint over HTTPS; it does **not** cryptographically verify the Wormhole VAA. There is no stablecoin peg assumption. An OG mint without a supported historical feed remains unsupported until a separate independent market-price adapter is reviewed.

Manual movement classifications must reconcile to independently fetched finalized receipts. Purchases additionally require the exact verified oracle observation. An observed settlement requires an accepted evidence version: its bounded verifier checks every balance-changing receipt in complete wallet history against classified events, and every ledger event against that history. Legacy manual seals alone cannot authorize finalization. An unclassified transfer, unknown price or gap blocks finalization. The classifier is deliberately narrow: this phase does not claim to decode every Solana swap, Token-2022 extension or transaction version automatically.

**No live Helius or Pyth collection has been run.** No corresponding credentials were found in the existing configuration. Both new provider budgets start at zero; there is no API to raise them and no automatic quota reset. An attempted call first reserves its worst-case allowance; failed requests/retries retain that charge. Approving a provider, credentials, price-feed mappings and its exact allowance is a separate operating decision. Existing Network Alchemy, Neynar and request caps are unchanged. Copy the empty `meme/dev.vars.example` to ignored `.dev.vars` only when authorized; secrets stay server-side and outside Git.

The current 20-transaction Helius profile reserves 10 credits per attempt, matching its published rounded-up minimum, and conservatively retains reservations on failures. Its zero ceiling is unchanged. The adapter rejects pre-2023 campaign history because token-account discovery cannot establish older ownership coverage without an additional archival adapter.

After an authorized source run has been created, `pnpm --dir meme operator collect <run-id>` advances its persisted pages at one request per second. Restart the same command to resume. Exhausted/unapproved allowances stop the command; it never raises a ceiling, resets usage or retries indefinitely.

## Correction versions

Legacy events, source pages and seals are immutable. Corrections create a new evidence version; they never edit those rows or settled entitlements.

1. Propose `/sources/correction` with an ID, parent correction if applicable, campaign, reason, SHA-256 manifest placeholder and effective cutoff. A proposal blocks affected future finalization.
2. `/versions/start` supplies ID, parent sealed version, correction ID, campaign, effective/through cutoffs, complete wallet scope and source mode. Append pages to `/versions/append` with `{id,events}`. Observed pages verify receipts and independent prices.
3. Repeat `/versions/preview` until it returns `review_ready` with the content manifest. The immutable event set enters `checking`; each call verifies at most 20 historical receipts for one wallet and persists its checkpoint. Events cannot be appended during verification. Review that exact hash at `/sources/correction-review`, with the reason and actor recorded. Rejecting a proposal is explicit and reasoned.
4. `/versions/seal` requires the reviewed hash. Activation and resolution of the proposal occur atomically. Reads choose the latest accepted effective version, and a version that does not cover the requested scope/time remains pending; there is no fallback to older evidence to conceal a gap.

Version creation **and activation** reject effective cutoffs at or before any existing settlement freeze, including unfinished freezes. An old provisional snapshot retains its captured version IDs. New accepted evidence can change only subsequent provisional results. A sealed version is currently limited to 5,000 classified events and 1,000 wallets; larger evidence requires a paginated replay implementation before activation. Public score materialization caps replay at 5,000 relevant events per participant/campaign and reports pending on overflow. These are explicit coverage limits, not silent truncation.

## Score snapshots and read behavior

Each snapshot atomically captures the roster, vote timestamps, frozen wallet scopes, ownership levels, streak inputs, campaign metadata, accepted version IDs and append-only event/seal watermarks. One participant is processed per step. New votes do not mutate or starve an in-progress snapshot; another minute's snapshot follows it. Scores are computed using the existing `local-v1` pure ledger/boost functions. Publication swaps the head only after every row is present and its hash is recorded; an older job cannot replace a newer head.

Public reads only project a published head, candidate aggregates, top 100 and the viewer's private boost. They do not advance rounds, replay ledgers, enqueue jobs or collect data. Finalized reads continue using the immutable settlement projection. `scoreSnapshot` adds status, as-of time and a result hash compatibly. Before the first head, the UI says “Scores updating.” Incomplete holdings stay provisional and block settlement.

## Verification and limits

Tests exercise migration replay, exact old/new score agreement, immutable sources, pagination, lost responses, lease fencing, correction approval, gap blocking, quota preservation, a 1,200-account roster, and fixed-query public projection. This is not a production load certification, provider entitlement check, physical-wallet test or executed token launch. Source collection scheduling and broad swap decoding remain dependent on the approved provider/configuration and supported receipt set.

# Milestones 1–3: local implementation

The owner authorized building all six PRs on 30 October 2026, committing and pushing each, with no deployment. PRs are stacked on the foundation branch. No remote resources, production migrations or paid-budget changes are part of this work.

1. Shared Connect extraction — PR #86: existing UI and clients, compatibility exports, extracted EVM authentication primitives; all 853 app regressions and production build passed.
2. Identity — verified Farcaster sessions, Base wallet linking and Ed25519 Solana reward-wallet proofs in the isolated local database. Same-origin APIs, one-use expiring challenges, host-bound opaque sessions and local-host exposure guards.
3. Persisted rounds, frozen ownership evidence, changeable votes and operator outcomes.
4. Deterministic attribute cycles, streaks and additive boosts.
5. Replayable acquisition-value holding ledger.
6. Frozen settlement inputs, ranked recipients and immutable entitlements.

The proposed policies in the implementation plan are **versioned local working rules**, not approval to activate financial operations. Their numerical examples and behavior are tested. Production review can choose a new version without rewriting historical settlements.

The browser uses the same `@10x/connect` Farcaster/Base/wallet components as the existing products. Solana Wallet Standard message signing extends the Connect modal. A connected EVM address cannot establish a Farcaster FID. Signing uses no transaction. Existing application cookies remain host-scoped; this work does not create cross-subdomain SSO.

## Local development

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --dir meme db:migrate
pnpm --dir meme dev:worker
# Another terminal:
pnpm --dir meme dev
```

The frontend on `127.0.0.1:5194` proxies same-origin API calls to the local Worker on 8797. All launchpad state is under `meme/.wrangler`. Both the local-mode flag and a loopback request hostname are required for participation APIs. Launch execution, funding and claim submission remain disabled. No production secrets are needed to verify ordinary wallet proofs or Farcaster sign-in.

## Operator and ownership

After migrations, `pnpm --dir meme operator init` registers a local operator and stores its token in ignored `meme/.wrangler/operator-token`. `pnpm --dir meme operator demo` creates one clearly simulated round with empty simulated ownership. It retains an existing round rather than overwriting it. The normal browser shows persisted local participation; `?fixture=1` shows the original design fixtures, and `?operator=1` exposes the authenticated operator console.

Use `pnpm --dir meme operator request /api/meme/operator/rounds path/to/round.json` for a reviewed shortlist. The JSON includes `id`, `day` (UTC close/selection date), `attribute`, and candidates with `id`, `name`, `symbol`, valid `ogMint` and screening `evidence`. The working schedule opens at 20:00 UTC the preceding day and closes at 19:30 UTC. Explicit `opensAt`/`closesAt` milliseconds are available for local tests. One round per UTC close date and nonoverlapping windows are enforced in SQLite.

`operator ownership-export <existing-warplets-sqlite-path>` takes a consistent read-only export of `warplet_market_state` joined to the canonical ten metadata attributes. It does not use Network indexes, original airdrop allocations or preferred-FID heuristics. The output stays in `.wrangler/ownership-source.json`. An observed freeze requires all 10,000 resolved owners and attributes, evidence at most 24 hours old, a source checkpoint and completion before reveal. Unknown/stale observations block the freeze. The frozen manifest records source, time, mode and digest; ownership rows import resumably and become eligible only when ready. A simulated freeze is explicitly labeled.

Submit that file to `/api/meme/operator/rounds/<id>/freeze`. Wallet links verified before the snapshot are eligible; ambiguous links are excluded. Vote updates preserve the first valid timestamp and original reward destination. Unique round-level wallet reservations and transactional guards reject duplicate-account use and closing races. After close, `/api/meme/operator/rounds/<id>/outcome` accepts either `{ "candidateId": "...", "reason": "..." }` or `{ "skip": true, "reason": "..." }`. Voting and selection do not execute transactions.

## Attribute cycles and scoring

Create a cycle through `/api/meme/operator/cycles` with `{ "id": "cycle-01", "startDay": "YYYY-MM-DD" }` before its first voting window opens. The Worker generates and commits a cryptographically random seed. A SHA-256 counter shuffle uses rejection sampling; the ten canonical attributes occur exactly once per ten-calendar-day cycle. Overlapping cycles and edits are rejected. A normal round supplies `cycleId` and `day`; its attribute is derived from the committed cycle. Explicit manual attributes require `simulated: true` for local testing. No private cycle order is returned before the cycle's last close. Afterwards `/api/meme/cycles/<id>` reveals the seed and order for commitment verification.

Scores use 10,000 integer units per multiplier, with maximum 100,000 units (10x). Warplet bonus is level times 3,000 units; streak is 1,000 per consecutive offered-round vote, capped at ten. The current valid vote counts, missed offered rounds reset the streak, and unoffered rounds do not appear in its history. Both weighted candidate totals and reward rankings use this same calculation. No vote means zero reward points. Equal scores use first valid server timestamp, then ascending FID. Candidate choice adds no bonus. Leaderboards remain provisional until settlement.

## Holding ledger and source evidence

The first vote freezes every verified Solana reward/holding wallet for that round. Later links affect later rounds. Additional holding wallets use the same Wallet Standard signing control in Connect. A round reserves each scoped wallet to one FID.

Record a launched edition at `/api/meme/operator/campaigns`: `id`, `mint`, `symbol`, actual `launchedAt` milliseconds, integer-string `totalSupply` in smallest units, `decimals`, `mode` (`observed` or `simulated`) and `launchEvidence`. This records evidence of a launch; it cannot launch a token. Supply must divide by 100 exactly. Ten daily releases start at actual launch +24 hours.

Import finalized observations through `/api/meme/operator/ledger`. Supply `campaignId`, `scopeWallets`, `events`, `throughAt`, `throughSlot`, `cursor`, `source`, `mode`, `complete` and `fromMint`. A completed prefix seals the declared wallet scope from mint through its timestamp. Retries are idempotent; contradictory duplicate events, backward checkpoints and new events inside a sealed prefix are rejected. Newer incomplete pages do not invalidate an earlier seal. Missing coverage or unreconciled inventory remains **pending** and blocks settlement, rather than silently earning zero.

Each event includes signature, event index, finalized slot/time, smallest-unit quantity and purchase/airdrop/sell/transfer classification. Purchases also require payment mint/decimals, paid units, historical USD price in microdollars, quote time within five minutes and evidence hash. Observed imports reconcile successful finalized Solana receipts against edition/payment balance changes using a bounded public RPC adapter (60 reservations/minute); ambiguous receipts fail. Simulated imports make no network calls. No Alchemy or Neynar allowance changes are involved. Complete-history discovery and the historical price evidence remain source-attested operator inputs: this is not an autonomous production indexer or price oracle. Live source integration, supported-protocol coverage and independent quote verification are subsequent gates.

All credit uses reduced BigInt fractions. A $100 purchase earns two points per day from acquisition; a later $10 top-up cannot earn retroactively. Airdrops contribute quantity but no acquisition value. A disposal reduces every retained purchase lot proportionally to the combined purchased/airdropped quantity: buying $100, receiving an equal airdrop and selling 25% leaves $75 credit. Transfers between wallets in the frozen verified scope preserve lots and dates; transfers out dispose of credit, external receipts create no credit, and rebuys start a new clock. Current market price never rewrites acquisition value. Invalid inventory leaves the round pending. Corrections require a future explicit source/version workflow; sealed inputs cannot be edited in place.

For each campaign active at close, integrate retained credit thresholds over acquisition intervals: below $10 earns zero, $10 to below $100 earns one point/day, $100 or more earns two. Normalize the sum of those point-milliseconds against twice the elapsed milliseconds across **all** active campaigns, then floor once to 50,000 holding units (maximum +5x). A full-credit campaign alone earns +5x; one full and one equally old empty campaign earn +2.5x. There is no holding bonus when no campaign is active. Only unsettled scores can change; final entitlements are never clawed back.

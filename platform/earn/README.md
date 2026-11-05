# Earn local pilot

The HTTP routes expose a wallet's own submissions, the global daily board and read-only vesting previews. The operator CLI writes synthetic observations to the same local SQLite file as the server. It never reads chain state, fetches submitted URLs, signs, burns or transfers tokens. Arbitrary wallet IDs are useful for offline tests. HTTP requests take their wallet identity exclusively from the verified session.

From the repository root, run `node --test platform/domain/earn/earn.test.mjs platform/earn/workflow.test.mjs`. To exercise the operator workflow, pass a local JSON fixture to each command:

```text
node platform/earn/operator.mjs ./earn-pilot.sqlite campaign campaign.json
node platform/earn/operator.mjs ./earn-pilot.sqlite stake observation.json
node platform/earn/operator.mjs ./earn-pilot.sqlite review review.json
node platform/earn/operator.mjs ./earn-pilot.sqlite facts member.json
node platform/earn/operator.mjs ./earn-pilot.sqlite finalize epoch.json
node platform/earn/operator.mjs ./earn-pilot.sqlite allocate day.json
```

| Fixture | Required fields |
| --- | --- |
| campaign | `tokenId`, `activationMs`, `originalUnits` (decimal string divisible by 100) |
| stake | `wallet`, `tokenId`, `observedMs`, `expiresMs`, `microUsd` (decimal string), `sourceRef` |
| review | `submissionId`, `score` (0–10), `reason`, `moderator`, `sourceRef`, `reviewedMs` |
| facts | `epoch`, `wallet`, `intervals`, `completions`, `highestEligibleLevel`, `purchaseTokenDays`, `sourceRef` |
| finalize | `epoch`, `nowMs`, `sourceComplete`, `sourceRef` |
| allocate | `tokenId`, `day` (1–10), `nowMs` |

1. Register a campaign and a stake observation before submitting. Timestamps are Unix milliseconds, epochs are whole UTC days since 1970-01-01, and 10,000,000 micro-USD equals US$10. For this fixture a read's validity window is at most five minutes.
2. A signed-in contributor sends `POST /api/v1/earn/submissions` with matching Origin, an Idempotency-Key, and a JSON body containing `tokenId` and `url`. The pilot admits up to 100 submissions per board. Missing current stake evidence returns a retryable pending response without taking a slot.
3. Record the review and the position read at the last millisecond of the board. Record member facts for each qualifying wallet, including explicit zero values. Catalog intervals use `{ actionId, startEpoch, endEpoch }`, with end exclusive or null; completion records use `{ actionId, verifiedAtMs }`. In this pilot the operator supplies fixture evidence for NFT Level, verified actions and purchased token-days. No contributor can supply their own bonus.
4. Finalize after the board closes and the operator attests the input set is complete. Missing evidence holds the board. A rejected submission needs no closing stake read. A late review still settles its original submission board, while an eligible approval advances the streak in its approval day. Finalization locks the evidence references, decisions and ranking in one transaction.
5. Record each token/day from its designated board. A complete, empty prior board permits the first 1% budget to burn in the local ledger. The token/day uniqueness constraint makes replay safe. Inspect `GET /api/v1/earn/epochs/YYYY-MM-DD/leaderboard`; an unfinalized day reports `pending`, while a valid empty board reports `final`.
6. A signed-in wallet can page through `/api/v1/earn/me` and `/api/v1/earn/claims` using `nextCursor`. Amounts are decimal strings in token base units. Remaining awards do not expire. A custody/distributor implementation and independently verified chain observations are release gates before this could pay real rewards.

# Earn local pilot

The HTTP routes expose a wallet's own submissions, the global daily board and read-only vesting previews. The operator CLI writes synthetic observations to the same local SQLite file as the server. It never reads chain state, fetches submitted URLs, signs, burns or transfers tokens. Arbitrary wallet IDs are useful for offline tests. HTTP requests take their wallet identity exclusively from the verified session.

From the repository root, run `node --test platform/domain/earn/earn.test.mjs platform/earn/workflow.test.mjs`. To exercise the operator workflow, pass a local JSON fixture to each command:

```text
node platform/earn/operator.mjs ./earn-pilot.sqlite campaign campaign.json
node platform/earn/operator.mjs ./earn-pilot.sqlite stake observation.json
node platform/earn/operator.mjs ./earn-pilot.sqlite review review.json
node platform/earn/operator.mjs ./earn-pilot.sqlite owner holdings.json
node platform/earn/operator.mjs ./earn-pilot.sqlite finalize epoch.json
node platform/earn/operator.mjs ./earn-pilot.sqlite allocate day.json
```

| Fixture | Required fields |
| --- | --- |
| campaign | `tokenId`, `activationMs`, `originalUnits` (decimal string divisible by 100) |
| stake | `wallet`, `tokenId`, `observedMs`, `expiresMs`, `microUsd` (decimal string), `sourceRef` |
| review | `submissionId`, `score` (0–10), `reason`, `moderator`, `sourceRef`, `reviewedMs` |
| action | `actionId`, `label`, `verifier`, `enabled`, `effectiveEpoch`, `atMs` |
| completion | `wallet`, `actionId`, `verifier`, `verifiedMs`, `sourceRef` |
| collection | `collectionId`, `kind` (genesis/season), `seasonStartMs` for a Season |
| owner | `wallet`, `epoch`, `asOfMs` (closing millisecond), `assets` (complete wallet snapshot), `sourceRef` |
| enroll | `wallet`, `tokenId`, `enrolledMs` |
| event | `wallet`, `tokenId`, `atMs`, `sequence`, `type`, `confirmed`, `signature`, `instructionIndex`, `sourceRef`, event details |
| position | `epoch`, `wallet`, `tokenId`, `asOfMs` (closing millisecond), `reconciledSequence`, `stakedUnits`, `priceNumerator`, `priceDenominator`, `sourceRef` |
| finalize | `epoch`, `nowMs`, `sourceComplete`, `sourceRef` |
| allocate | `tokenId`, `day` (1–10), `nowMs` |

1. Register a campaign and a stake observation before submitting. Timestamps are Unix milliseconds, epochs are whole UTC days since 1970-01-01, and 10,000,000 micro-USD equals US$10. For this fixture a read's validity window is at most five minutes.
2. A signed-in contributor sends `POST /api/v1/earn/submissions` with matching Origin, an Idempotency-Key, and a JSON body containing `tokenId` and `url`. The pilot admits up to 100 submissions per board. Missing current stake evidence returns a retryable pending response without taking a slot.
3. Record the review and stake read at the last millisecond of the board. Record complete ownership evidence for each qualifying wallet, using an empty asset list for zero holdings. Each record contains `assetId`, `owner`, `chain` (solana), `collectionId` and `level`. The board selects the highest eligible Level from registered Solana Genesis and unexpired Season assets. Configure actions for future boards and record individual completions from their named verifiers. The board counts active verified completions and caps them at ten. The public action catalog is available at `GET /api/v1/earn/actions`.
4. Enroll purchased-stake positions prospectively and import confirmed activity in order. A purchase has one transaction signature with separate `swap` and `deposit` proofs, each containing its signature, instruction index, wallet and token. Use decimal strings for `swap.netBoughtUnits` and `deposit.depositedUnits`. The pilot credits one combined purchase per wallet, token and transaction. A withdrawal supplies `withdrawnUnits` and `remainingStakeUnits`. Rewards, unrelated deposits and restakes add zero credited principal. Reconcile every active enrolled position at each cutoff: numerator/denominator expresses micro-USD per token base unit. Missing checkpoints hold the board. Ownership and position observations are local fixtures supplied by the operator, and all multiplier components are derived from these inputs.
5. Finalize after the board closes and the operator attests the input set is complete. Missing evidence holds the board. A rejected submission needs no closing stake read. A late review still settles its original submission board, while an eligible approval advances the streak in its approval day. Finalization locks the evidence references, decisions and ranking in one transaction.
6. Record each token/day from its designated board. A complete, empty prior board permits the first 1% budget to burn in the local ledger. The token/day uniqueness constraint makes replay safe. Inspect `GET /api/v1/earn/epochs/YYYY-MM-DD/leaderboard`; an unfinalized day reports `pending`, while a valid empty board reports `final`.
7. A signed-in wallet can page through `/api/v1/earn/me` and `/api/v1/earn/claims` using `nextCursor`. Amounts are decimal strings in token base units. Remaining awards do not expire. A custody/distributor implementation and independently verified chain observations are release gates before this could pay real rewards.

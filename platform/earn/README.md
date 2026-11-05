# Earn local pilot

The HTTP routes expose a wallet's own submissions, the global daily board and read-only vesting previews. The operator CLI writes synthetic observations to the same local SQLite file as the server. It never reads chain state, fetches submitted URLs, signs, burns or transfers tokens. Arbitrary wallet IDs are useful for offline tests. HTTP requests take their wallet identity exclusively from the verified session.

From the repository root, run `node --test platform/domain/earn/earn.test.mjs platform/earn/workflow.test.mjs`. To exercise the operator workflow, pass a local JSON fixture to each command:

```text
node platform/earn/operator.mjs ./earn-pilot.sqlite campaign campaign.json
node platform/earn/operator.mjs ./earn-pilot.sqlite source source-policy.json
node platform/earn/operator.mjs ./earn-pilot.sqlite observation raw-checkpoint.json
node platform/earn/operator.mjs ./earn-pilot.sqlite review review.json
node platform/earn/operator.mjs ./earn-pilot.sqlite owner holdings.json
node platform/earn/operator.mjs ./earn-pilot.sqlite finalize epoch.json
node platform/earn/operator.mjs ./earn-pilot.sqlite allocate day.json
```

| Fixture | Required fields |
| --- | --- |
| campaign | `tokenId`, `activationMs`, `originalUnits` (decimal string divisible by 100) |
| source | Registered ATT/OG pool, farm, OG feed, mint decimals and explicit freshness, depth and movement limits |
| observation | `wallet`, `tokenId`, `asOfMs`, pool and OG quote, wallet farm units, historical reference, executable depth probe |
| review | `submissionId`, `score` (0–10), `reason`, `moderator`, `sourceRef`, `reviewedMs` |
| action | `actionId`, `label`, `verifier`, `enabled`, `effectiveEpoch`, `atMs` |
| issuer | `issuerId`, `actionId`, `verifier`, `pubkey`, prospective `fromEpoch` and exclusive `untilEpoch`, `atMs`, `actor`, `evidenceRef` |
| revokeIssuer | `issuerId`, `expectedRevision`, `atMs`, `actor`, `evidenceRef` |
| completion | `wallet`, `actionId`, `proof`, `signature`, `now`; same scoped signature checks as the HTTP API |
| collection | `collectionId`, `kind` (genesis/season), `seasonStartMs` for a Season |
| owner | `wallet`, `epoch`, `asOfMs` (closing millisecond), `assets` (complete wallet snapshot), `sourceRef` |
| enroll | `wallet`, `tokenId`, `enrolledMs` |
| event | `wallet`, `tokenId`, `atMs`, `sequence`, `type`, `confirmed`, `signature`, `instructionIndex`, `sourceRef`, event details |
| position | `epoch`, `wallet`, `tokenId`, `asOfMs` (closing millisecond), `reconciledSequence`, `sourceRef`; stake amount and price come from that wallet's verified observation |
| finalize | `epoch`, `nowMs`, `sourceComplete`, `sourceRef` |
| allocate | `tokenId`, `day` (1–10), `nowMs` |
| workload | `effectiveEpoch`, `atMs`, `staffedMinutes`, `secondsPerReview`, `admissionLimit`, `operator`, `reason` |
| queue | `epoch`, optional `state` (pending/reviewed), `limit` (1–100), `cursor` |
| metrics | `epoch`, `nowMs` |

1. Register a campaign, its price policy and a wallet position observation before submitting. Timestamps are Unix milliseconds, epochs are whole UTC days since 1970-01-01, and 10,000,000 micro-USD equals US$10. Read [the pricing fixture guide](../pricing/README.md) for the inputs, bounds and independent SDK check.
2. Configure staffed moderator capacity before opening admissions. One hour at three minutes per review provides twenty slots. The effective limit is the lesser of staffed throughput, the chosen admission limit and the 100-slot pilot ceiling. Decreasing capacity preserves all accepted submissions and their idempotent retries. `GET /api/v1/earn/capacity` shows the available slots. A signed-in contributor sends `POST /api/v1/earn/submissions` with matching Origin, an Idempotency-Key, and a JSON body containing `tokenId` and `url`. Missing stake evidence takes no slot.
3. Record the review and stake read at the last millisecond of the board. Record complete ownership evidence for each qualifying wallet, using an empty asset list for zero holdings. Each record contains `assetId`, `owner`, `chain` (solana), `collectionId` and `level`. The board selects the highest eligible Level from registered Solana Genesis and unexpired Season assets. Configure actions for future boards and record individual completions from their named verifiers. The board counts active verified completions and caps them at ten. The public action catalog is available at `GET /api/v1/earn/actions`.
4. Enroll purchased-stake positions prospectively and import confirmed activity in order. A purchase has one transaction signature with separate `swap` and `deposit` proofs, each containing its signature, instruction index, wallet and token. Use decimal strings for `swap.netBoughtUnits` and `deposit.depositedUnits`. The pilot credits one combined purchase per wallet, token and transaction. A withdrawal supplies `withdrawnUnits` and `remainingStakeUnits`. Rewards, unrelated deposits and restakes add zero credited principal. Reconcile every active enrolled position at each cutoff: numerator/denominator expresses micro-USD per token base unit. Missing checkpoints hold the board. Ownership and position observations are local fixtures supplied by the operator, and all multiplier components are derived from these inputs.
5. Finalize after the board closes and the operator attests the input set is complete. Missing evidence holds the board. A rejected submission needs no closing stake read. A late review still settles its original submission board, while an eligible approval advances the streak in its approval day. Finalization locks the evidence references, decisions and ranking in one transaction.
6. Record each token/day from its designated board. A complete, empty prior board permits the first 1% budget to burn in the local ledger. The token/day uniqueness constraint makes replay safe. Inspect `GET /api/v1/earn/epochs/YYYY-MM-DD/leaderboard`; an unfinalized day reports `pending`, while a valid empty board reports `final`.
7. A signed-in wallet can page through `/api/v1/earn/me` and `/api/v1/earn/claims` using `nextCursor`. Amounts are decimal strings in token base units. Remaining awards do not expire. A custody/distributor implementation and independently verified chain observations are release gates before this could pay real rewards.

## Export and recover public awards

The public archive contains ranked wallet awards, token supply, activation times, vesting windows and burns. It omits content URLs, private moderation records, sessions and source evidence. Keep separate backups of the operator database for those records.

```text
node platform/earn/archive-cli.mjs export ./earn-pilot.sqlite 20001 ./board-20001.json
node platform/earn/archive-cli.mjs verify ./board-20001.json PINNED_DIGEST
node platform/earn/archive-cli.mjs restore ./recovery.sqlite ./board-20001.json PINNED_DIGEST
```

Store the export digest independently of the file. Verification checks the pinned digest, board ranking, 10% caps, supply conservation and vesting schedule. The board commitment stays fixed. A later token allocation for the same board creates a new bundle digest. Recovery adds verified allocations, rejects conflicting records and safely accepts retries. Serve the local API against the recovery database to read the leaderboard and vested award previews without the original operator database. Recovery imports do not create private balances or enable transactions.

Wallet owners can retrieve `/api/v1/earn/claims/proof?tokenId=ATT&day=2` and verify it against the allocation’s root in the pinned `/api/v1/earn/epochs/YYYY-MM-DD/manifest`. The local proof binds wallet, token base units, campaign day, board commitment and vesting window. Leaves sort by wallet, each pair keeps left/right order, and an unpaired node advances unchanged. All hashes use SHA-256 over UTF-8 canonical JSON arrays with explicit format and purpose labels. This is an offline integrity scheme. The eventual distributor must validate its own program-specific proof format.

Run `node platform/earn/recovery-drill.mjs` to rehearse a missing cutoff observation, independent private backup, recovered settlement and public claim export. The command uses disposable synthetic wallets and fresh local databases, and emits only aggregate status.

## Onboarding proof issuer

A named action verifier needs a registered Ed25519 public key, scoped to one action and a prospective epoch interval. The issuer attests a source-evidence hash for the signed-in wallet, with a nonce and an expiry of at most ten minutes. `POST /api/v1/earn/actions/{actionId}/completions` accepts only this proof and signature. It checks the current grant, domain, action, wallet, lifetime, configured verifier and active action state. The acceptance timestamp controls the prospective completion credit.

`signedCompletionBytes` defines the exact ordered field encoding. Issuers must sign those bytes and encode the signature in base58. The protocol rejects weak and noncanonical Ed25519 point/signature encodings before runtime verification. Grant rotation and revocation are append-only. Replaying the same previously accepted proof returns its receipt and creates no second credit. An opt-out/disabled action stops contributing at its configured future board. Existing finalized boards remain frozen.

This framework does not verify a Farcaster follow or other outside action by itself. A selected provider adapter must obtain evidence and sign only a valid action. Private signing keys are outside the app, fixtures and repository. Tests generate throwaway keys locally.

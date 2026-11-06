# Financial decision packet

This packet records local preparation, not release approval. `financial-decisions.json` identifies the retained source commit and SHA-256 for each source document. Review owners and provider selections remain null. Existing failures remain incompatible even when another fixture passes.

## Claims and reserve assignment

The Rewards replay supports the 17-byte tagged linear schedule and 57-byte inner leaf payload shape used by `platform/claims/recorded-codecs.mjs`. Its payload contains claimant, amount and schedule. Distribution and mint belong to the account context and must be independently verified. The Rewards root uses Keccak-256 with a prefixed, double-hashed leaf and sorted-pair branches in the retained replay. The public Earn archive uses a different SHA-256 commitment format and cannot be submitted as this proof.

No standalone frozen leaf/root/proof byte vectors are retained in the inspected fixture files. The codec therefore implements only the supported byte shapes. It explicitly returns `missing-frozen-leaf-root-proof-vectors`; it does not synthesize a Merkle verifier or infer hash parity from a round trip. Existing replay code remains source evidence and is never imported or executed by this codec. No instruction, signer, transaction or broadcaster is exposed.

Wallet-bound Earn rights remain with the named wallet. A Vault candidate would instead use the stable Core asset signer, while current ownership authorizes execution. The recorded seller rejection and buyer payout are scoped fixture evidence. Actual PDA derivation, distribution/mint funding, ownership and plugin policy remain unverified by this codec. The maximum signed 64-bit clawback timestamp is finite, not a native permanent flag. Durable proofs and claim history must survive service loss, ownership transfer and Season expiry.

The controlled future asset key in the old experiment did not establish fair reserve assignment. Every promised unminted allocation must be backed from the first funded ATT. Never derive new entitlement on mint or restore a spent cumulative claim. Public claim amounts may reveal Level before image reveal: the release policy must acknowledge that conflict without postponing vested rights or promising fabricated secrecy.

## Asset and collection policy

Reject the tested removable-Oracle and permanent-burn-delegate configurations. Ordinary burns stranded signer funds. Setting the Oracle's own authority to None did not prevent the asset update authority removing it. The permanent burn delegate could bypass the veto. An unreachable update authority blocked tested owner burns but restricts required metadata refreshes and progression; it is not an accepted solution.

The release decision needs one exact asset **and collection** policy, with every update, burn, freeze, execute, delegate and upgrade role. Required refresh and Level changes must coexist with custody protection. Marketplace escrow, transfer, claim control and royalty behavior require their own evidence. A missing burn button offers no external burn protection.

## Farm authority, precision and funding

`platform/stake/readiness.mjs` checks bounded caller-supplied accounting assertions. It never authenticates provider balances or configuration. It requires exactly 5% gross funding and separates principal, earned-unclaimed liability and idle rewards. A proposed idle withdrawal fails the arithmetic check if it consumes protected liabilities or exceeds isolated idle funds. This is necessary accounting, not transaction approval.

Required upkeep includes reward refresh, prescribed default-curve transition at campaign end and isolated idle recovery. Forbidden powers include principal redirection/withdrawal, reassigning authority to regain that power, and premature cancellation of funded emissions. The recorded unrestricted-admin counterexample remains a failed release condition.

The successful curve used 1,000,000 whole reward base units per second. Fractional rates, decimals, arbitrary supply, refresh frequency and protocol rounding remain unproven. The selected global fee must be verified; a dated zero fee is not a guarantee. A nonzero fee reduces disclosed net receipts and never authorizes another allocation's top-up. The module's hypothetical fee floor is illustrative and cannot replace reconciliation of cumulative fees already charged.

Costs remain incomplete: dated farm/user/token-account rent and Core Execute charges exclude other account creation, signatures, priority fees, lookup tables, retries and conversion rates. Retain payer, consumed fees, refundable rent and peak cash separately. Kamino source-to-binary correspondence and BSL use/licensing review remain unresolved.

## Calendar and review

Preserve the proposed UTC/day-eleven Earn mapping as a release-ratification gate. Late processing does not move activation dates, board choice or vesting clocks. Sydney launch hours and later mint prices stay open.

To review: run `node --test platform/claims/recorded-codecs.test.mjs platform/stake/readiness.test.mjs platform/validation/decisions/decisions.test.mjs`; inspect each finding, choose a named reviewer and collect the listed unlock evidence before any later release decision. This packet authorizes no funding, deployment, transaction, provider selection or new authority probe.

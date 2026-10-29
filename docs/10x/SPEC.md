# Curated daily OG-paired launches

## Confirmed product

10X.meme selects one Solana memecoin launch every 24 hours, or skips when no candidate qualifies. Community voting is advisory; 10X retains final selection authority. Candidates can be newly graduated OG memecoins or older tokens with renewed momentum. Momentum, liquidity, ownership concentration and suspicious wallet activity require review. Crawlscan supports screening; its evidence must be inspected rather than accepting a score automatically.

The everyday journey is **claim previous rewards → see today's attribute and boost → vote → follow selection and launch → build holding and participation history**. Research tooling and operator controls do not form the everyday navigation.

## Launch and campaign

- Initial chain: Solana. Intended infrastructure: Meteora DAMM v2.
- Each new token trades in one pool against the selected OG token. Initial liquidity is single-sided, funded with the new token.
- Supply allocation is 90% liquidity and 10% community rewards. “100% OG paired” describes the pairing, not supply allocation.
- Each campaign releases 1% of total supply at launch +24 hours, then another 1% daily through +240 hours. Nothing from the reward reserve releases during the first 24 hours.
- At a mature daily cadence, one day's winners can receive allocations from ten previous launches. The newly launched token first participates the following day. A skipped launch does not interrupt existing campaigns.
- Pool prices are denominated in OG. USD valuations depend on both the token/OG rate and the OG/USD price.
- A separate $10X ecosystem token is deferred. Base-held 10X Warplets are the consistent ecosystem layer; no bridge is required.

## Voting and reward ranking

- One active candidate vote per Farcaster identity per available round. Changing the candidate neither earns another base allocation nor changes the original valid-vote timestamp.
- A valid vote earns 10 base reward points. Combined additive boosts apply once to vote weight and reward points: maximum vote weight 10, maximum reward points 100.
- The top 100 qualifying accounts receive proportional allocations based on their boosted points within that group. Equal reward scores use the earliest valid vote.
- Voting for the selected OG earns no additional reward. Unique voter counts and weighted votes are displayed separately.
- Leaderboards are provisional until close. At close, compute holding bonus, include the current valid vote in the streak, use the frozen Warplet snapshot, and finalize weights, scores and recipients.
- Voting is the sole base-point activity for launch. External sharing is optional and earns no reward.

## Additive boost

**1× base + up to 3× Warplet + up to 5× holding + up to 1× voting streak = at most 10×.**

Warplets have ten attributes with ten levels each. A shuffled ten-day cycle features each attribute once, revealing one per day. Freeze eligible ownership before revealing it. Use the highest eligible featured-attribute level across the participant's Warplets; NFTs do not stack. The bonus is level ×0.3, capped at +3×. Reuse confirmed ownership tracking from the Warplets application; Network's analytics index is not an authoritative boost source.

The streak adds +0.1× for each consecutive daily vote, capped at +1×. Missing an available voting round resets it. If no voting round is offered, preserve it. A valid vote still counts if the operator ultimately skips launching.

## Holding credit

Use USD acquisition value of purchased units still held, not current market value. Remaining eligible acquisition value per token below $10 earns 0 holding points/day, $10–$99.99 earns 1, and $100+ earns 2. Count actual holding duration only within that token's ten-day campaign.

- Buying an older token starts a new holding clock; it does not inherit token age.
- Top-ups improve earning only going forward. Concentrating extra funds in one token does not substitute for holding multiple campaign tokens.
- Airdrops and externally received transfers earn no purchase credit. Price changes alone do not change credit.
- A disposal proportionally reduces acquisition credit against the combined purchased and airdropped position. Buying 1,000 units for $100, receiving 1,000 by airdrop, then disposing of 500 leaves $75 credit.
- Retained purchased lots preserve acquisition dates. Rebuys start new clocks. Verified transfers between the same account's wallets preserve credit. Final rewards are never clawed back.

Normalization to +0–5× across active campaigns remains unresolved. No accounting formula is implemented or implied by the skeleton's illustrative holding bonus.

## Identity and claims

Farcaster authenticates participation. A verified Solana wallet receives rewards; a linked Base wallet establishes Warplet ownership. A wallet or Warplet cannot supply boosts to multiple accounts in the same round. A Farcaster identity does not establish unique humanity.

Final allocations become claimable after processing, subject to each token's minimum first release at +24 hours. Unclaimed allocations accumulate. Claim all may require multiple transactions. Users pay network and required token-account costs. Claiming adds no points or streak credit. There is no planned expiry or additional holding condition on finalized rewards. The distributor remains unselected; Jito's open-source distributor is a feasibility candidate.

## Working assumptions, not settled protocol settings

- Working launch time: 20:00 UTC, 7am Sydney/Melbourne during daylight saving and 6am during standard time. Round-open, close and delay rules remain undecided.
- Approximately $10k initial FDV, converted using the OG/USD price at launch. Upper price boundary unresolved.
- Ten-minute declining opening fee; initial rate and exact settings unresolved. Do not inherit a 100% opening fee from older material.
- Working ongoing fee: 1% on buys and sells, collected in OG. Protocol feasibility must be demonstrated.
- Permanent initial liquidity lock is intended. Exact supported lock/fee authority configuration remains unresolved.
- No automatic fee reinvestment or active LP management for v1.
- Fees accrue in OG tokens. Treasury sales require disclosure; selling through an LP position is still selling. Allocation and conversion policy remain undecided.

Fixture amounts, token names, timestamps, supply size and voting-close time illustrate the UI only. They are not additional product decisions. In particular no $1bn upper boundary is specified.

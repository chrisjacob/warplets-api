# Physical wallet and marketplace review packet

Every case below is **manual-required / not performed**. Local browser emulation and unsigned packet tests cannot fill these rows as passed. This packet is for a later explicitly authorized release review; it authorizes no real-wallet transaction signing, funding, broadcasting, marketplace trade or provider enrollment now.

## Record one exact configuration per run

| Field | Reviewer entry |
|---|---|
| Run identifier, UTC date and reviewer | Unfilled |
| Device manufacturer/model | Unfilled |
| OS and exact version | Unfilled |
| Browser and exact version | Unfilled |
| Wallet name and exact version | Unfilled |
| Connection method: extension / injected / mobile browser / deep link | Unfilled |
| Network name and genesis identity shown to user | Unfilled |
| App source commit and build digest | Unfilled |
| Wallet Standard discovery and message feature versions | Unfilled |
| Venue name/version and asset standard | Unfilled |
| Exact asset and collection plugin/authority configuration | Unfilled |
| Approved evidence scope and authorization reference | Unfilled |
| Evidence location and SHA-256; redact secrets | Unfilled |

## Connection and authentication

| Case | Required observation | Status | Result / evidence |
|---|---|---|---|
| Discover/connect | Supported wallet appears once; unavailable message feature is explained | manual-required | Unfilled |
| Message review | Exact origin, local sign-in action, account, chain, nonce and expiry are visible | manual-required | Unfilled |
| Reject | Rejection leaves no authenticated session or false success | manual-required | Unfilled |
| Cancel app dialog | Closing the app dialog prevents delayed wallet completion from signing in | manual-required | Unfilled |
| Cancel wallet dialog | Wallet cancellation leaves a retryable sign-in state without session leakage | manual-required | Unfilled |
| Background and return | Switching apps/tabs does not silently renew the challenge or selected account | manual-required | Unfilled |
| Offline return | Failed network response preserves an honest state; reconnect does not assume acceptance | manual-required | Unfilled |
| Account switch | Original authenticated session remains clearly identified until reauthentication/sign-out; no silent relabeling to another wallet. Private state clears when session identity changes | manual-required | Unfilled |
| Disconnect/unregister | Session and private views clear; removed adapters disappear | manual-required | Unfilled |
| Expired request | Original expired challenge rejects; no automatic replacement of a pending operation | manual-required | Unfilled |
| Long addresses / keyboard | Full identity can be reviewed without clipping; dialog focus returns correctly | manual-required | Unfilled |
| Accessibility | Focus order, reduced motion and 360/390/768/1440-width layouts remain usable | manual-required | Unfilled |

## Unsigned preparation and later physical signing

| Case | Required observation | Status | Result / evidence |
|---|---|---|---|
| Immutable intent | Displayed action, subject, expected signer and plan hash match retained preparation | manual-required | Unfilled |
| Transaction version | Exact supported legacy/v0 version and lookup behavior are recorded | manual-required | Unfilled |
| Packet review | Serialized size, accounts, privileges, ordered instructions and message hash match reviewed bytes | manual-required | Unfilled |
| Physical signing/return | Later authorized packet is reviewed on the real device; return data binds those same bytes | manual-required | Unfilled |
| Expired packet | Expired unsubmitted packet is unavailable; replacement requires a new explicit preparation | manual-required | Unfilled |
| Ambiguous receipt | Preserve original attempt/message identity; reconciliation only, no automatic replacement or repeat send | manual-required | Unfilled |

The current harness has no transaction-sign or broadcast function. A passing local packet review is not evidence that a hardware wallet renders the intended details, a mobile link returns correctly, or a real network accepts the packet.

## NFT and marketplace cases

| Case | Required observation | Status | Result / evidence |
|---|---|---|---|
| Private transfer | Exact candidate asset/collection policy allows intended transfer and preserves economic history | manual-required | Unfilled |
| List | Actual venue accepts the exact candidate standard/plugins; listing owner and authority are understood | manual-required | Unfilled |
| Buy/fill | Buyer ownership and original cumulative Vault entitlement remain correct after fill | manual-required | Unfilled |
| Cancel | Cancellation restores expected custody without duplicating liabilities or resetting vesting | manual-required | Unfilled |
| Escrow ownership | Determine who can claim during escrow and how escrow evidence is authenticated | manual-required | Unfilled |
| Post-sale claim | Former owner is rejected; buyer receives only remaining vested entitlement | manual-required | Unfilled |
| Royalty realization | Actual recipient and realized amount are measured; target basis points alone prove no enforcement | manual-required | Unfilled |
| Metadata refresh | Venue refreshes approved image metadata while immutable identity/economic fields remain unchanged | manual-required | Unfilled |
| Authority compatibility | Existing burn/update/delegate incompatibilities remain unresolved until exact policy review | manual-required | Unfilled |

Unknown prices, royalty enforcement, Vault value and claim authority stay unknown. No verified execution evidence means no native marketplace trade action and no integration claim. A missing burn button is not protection from external burns. No new authority or burn probes are included in this packet.

## Review decision

Record pass/fail only for the exact case/configuration and attach its evidence. Keep failed, incompatible and unperformed cases visible. A successful message sign-in does not imply transaction signing; signing does not imply transfer/listing/fill/cancel support; a royalty target does not imply realized income. Disable only the affected adapter capability while retaining original operations, receipts and recovery evidence. Release approval remains separate.

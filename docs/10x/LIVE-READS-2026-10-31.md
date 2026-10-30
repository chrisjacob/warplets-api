# Bounded overnight live-read observations

Recorded 31 October 2026 (Sydney). The owner approved one shared maximum of 50 public blockchain requests, including failures/retries. The first checks consumed **17**: seven supplied-account balance reads, two ownership-checkpoint initialization calls, one canonicality check plus five ownerOf calls, and two program-capture calls. No paid credential, Network provider allowance, account setting, production record or chain state changed.

The account observation at 00:58:58 AEDT used finalized Base block **53289199**, actually timestamped **00:42:25 AEDT**. Warpmoji remains a holder in the supplied wallet scope. Balajis has zero in the supplied scope, while complete linked-wallet scope remains unknown. The 993-second finalized-block age remains explicit.

The new ownership collector successfully read five tokens at one finalized block using block-hash/canonicality-pinned calls. It remains **5/10,000** complete, with 9,995 unresolved records. Financial-freeze eligibility is false. A full fresh run at 20 owners per step requires at least 10,502 calls before retries (10,000 ownerOf, 500 canonicality checks, two initial calls), beyond this allowance. Its complete-roster proof is synthetic/offline, not a full live certification.

At finalized Solana slot **463310925**, the Meteora and Jito deployed binary hashes and upgrade authorities still match the already pinned capture. The fresh capture stays ignored; the approved fixture was not replaced. Source/binary correspondence is not asserted. Actual live capture/logs and checksummed ownership state are in the ignored `.tmp/qa-next-stage/overnight-*` files. Later approved reads continue to consume the same persistent ledger; do not initialize a new allowance in another worktree.

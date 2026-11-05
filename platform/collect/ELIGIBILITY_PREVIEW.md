# Read-only eligibility review

This operator-only local diagnostic reviews a Season free-stage snapshot before the existing immutable importer accepts it. It does not publish, grant a wallet session operator authority, contact an indexer, or verify real-chain coverage. There is no HTTP route. The SQLite file is opened read-only, and the preview uses one consistent read transaction.

From `platform/`, run:

```text
node collect/eligibility-preview-cli.mjs .local/preview.sqlite snapshot-review.json
```

The packet contains the existing snapshot fields `inventoryId`, `stageId`, `sourceRef`, `at`, `finalized` and `holdings`. Each holding has `id`, canonical Solana `owner`, `collection`, `level` (or null) and `revealedAt` (or null). Whitespace is reported as an error rather than silently changing a wallet. Duplicate IDs, even identical repeats, hold the preview; conflicting duplicates are distinguished.

Add explicit source and page evidence:

```json
{
  "source": {
    "id": "same-as-sourceRef",
    "chain": "solana",
    "collection": "solana-genesis",
    "slot": "123",
    "blockTimeMs": 1793923200000,
    "ownerRef": "synthetic-owner-cut",
    "revealRef": "synthetic-reveal-cut"
  },
  "coverage": {
    "status": "complete",
    "expectedCount": 2,
    "pages": [
      {"cursor": null, "nextCursor": null, "ids": ["synthetic-nft-a", "synthetic-nft-b"]}
    ]
  }
}
```

Use the actual published stage opening for both `at` and the source block-time anchor. Acceptance time never changes that boundary. At most 10,000 holdings, 100 pages, 100 IDs per page and 4 MiB are accepted. The first cursor is null; each next cursor must match the next page, every cursor and holding appears once, and the final cursor is null. An explicit complete empty cut has one empty terminal page and expectedCount zero. Missing pages are not an empty cut. Known local Genesis assets at the opening must all be present with the correct historical owner and public reveal; later transfers do not move eligibility to their buyer. Season-only holdings never qualify.

The output includes the published terms digest, opening cut, inventory revision, source identity/digest, complete input digest and the exact snapshot digest used by the existing importer. It reports eligible candidate wallets separately from accepted-ready eligible wallets, unknown wallets, late-reveal holdings, duplicate/normalization issues and local conflicts. Unknown counts cover the supplied valid wallet identities; an omitted holding is separately reported and cannot establish the number of unseen wallets. Any hold makes every supplied wallet's final eligibility unknown, while candidate reasons remain diagnostic. Source/page completeness is always labeled `complete-local-transcript` and `chainCompleteness: unverified`: these operator-supplied records prove no live-chain completeness.

`ready-local-fixture` means this read-only packet is internally consistent with the current local ledger. It is not publication or approval. The existing snapshot command still performs its own immutable-cut and current-state checks; an operator explicitly supplies that command separately. A matching published snapshot is reported as `already-published`; conflicting content is held, never rewritten. Retain the private diagnostic beside the fixture packet. It contains wallet addresses and must not be exported through a member/public route.

The member inventory projection separately exposes optional `reservationStatus`. Fixed opening membership in `eligibility` remains unchanged while current availability can be unknown, closed, sold out, opening-held or wallet-limit exhausted. `snapshotId` is the genuine accepted snapshot hash; it is null before acceptance. `remaining` is remaining per-wallet stage quota, not a promise that shared inventory remains. Every result is `source: local-fixture` and `executable: false`.

# Network snapshot storage

Network keeps the existing 1,800,000-byte row budget. Snapshot metadata stays
ordinary JSON for history selection, retention and chain-reorg reconciliation.
Aggregate cells are stored losslessly as a versioned gzip/base64 field using
standard CompressionStream/DecompressionStream APIs; no service, dependency or
paid storage tier is added. Public APIs still return ordinary dashboard JSON.
The decoder also reads all earlier plain-JSON snapshots unchanged.

Decoded cell data is bounded to 16MB while streaming, before JSON parsing, and
its population is reconciled to the stored denominator. Unsupported/corrupt
encodings fail closed. Publishing validates and encodes before inserting, so a
failed write leaves the last valid snapshot intact. Existing history is retained.

Verified against a full 50,000-account valuation fixture and the local dataset.
The first repaired real snapshot was 642,520 bytes instead of 1,836,112 bytes,
with 25,035 members and 13,725 valued wallets. Counts continue to change.

Idle location backfill no longer publishes duplicate snapshots. When waiting
for profile retries it checks every 15 minutes, rather than every minute; it
still respects source cooldowns and daily/monthly request budgets. The wallet
worker retries unexpected importer errors after 15 minutes and busy leases after
one minute instead of permanently stopping. Failed balances keep their prior
value. Alchemy remains capped at 1.5M CU/day, 10M CU/month and ten RPC/s;
Neynar is now capped at 250,000 credits/month following confirmation of the
account's 10M free allowance; shared request limits are unchanged.

Local production deployment remains disabled. Native and preview-runtime checks
cover the new format, historical reads, aggregate filters and live publication.

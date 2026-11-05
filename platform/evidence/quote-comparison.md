# Offline quote comparisons

`createQuoteComparison({crypto})` compares the unchanged quote arithmetic with independently retained records. It imports no provider client, transaction builder, signer, database or job runner. Every result has `executable:false` and `financialExecution:false`.

This is a **raw-pool-only comparison**. It does not establish oracle authenticity, finality, available vault funds, mint authority, original supply, quote freshness or execution rights. The guarded quote application separately binds its five account observations, B04 receipts and source policy. A comparison's recorded current point is an arithmetic input; it does not refresh an old observation.

## Records and independent requirements

The typed contract is in `quote-comparison.d.mts`. A record retains canonical base64 pool bytes and their SHA-256, source-file digest and source commit, recording identity, decoder version, program address/binary digest, ATT/OG mint and vault identities, activation/current-point milliseconds, direction, input amount and slippage. Expected requirements separately pin those identities and the SHA-256 of the entire canonical record, including its observed output and fees.

Expected pins must come from an independently retained operator evidence inventory. Computing a fresh expected hash from an untrusted replacement record does not verify that record's origin. The comparison verifies equality to supplied pins; it neither authenticates a chain reader nor decides whether a source is approved.

Observed successful output records contain recipient net output, gross output, separate input and output trading fees, their total, and the resulting sqrt price. The historical protocol observations contain **the protocol's 20% share**, which cannot substitute for a full trading fee. An inconsistent or differing delta fails. Only synthetic SDK rows may expect rejection, and their exact error code must match.

Captured-program records require a non-null binary digest and independently pinned exact pre-state. Synthetic SDK records require a null program binary digest and retain their synthetic label. Changing a record's evidence kind cannot make it match the other kind's requirement. A valid captured comparison would still be limited to its named recorded binary/configuration and pool state; it would not establish reviewed-source correspondence or ongoing production compatibility.

## Applicability

`compare(record, expected)` returns:

- `matched`: all pinned context and recorded output/fee deltas match, or the exact synthetic rejection matches.
- `incompatible`: source, state, program, layout, identities or requested input differ; its reason names the mismatch.
- `failed`: compatible inputs produce differing output/fees or an unexpected rejection.

`matrix({records, requirements})` keeps per-record incompatibility diagnostics and reports `missing` when no compatible record is present. A requirement with no retained exact-state context uses `expected:null`, an empty `recordIds` array and an explicit `missingReason`. It never invents unknown pre-state bytes or converts an absent case into a skipped parity success. Missing referenced record IDs also keep a requirement missing, even when another candidate matches.

Inputs are copied before the first asynchronous digest. Limits are 128 records, 128 requirements, eight candidate IDs per requirement and 8 KiB per record. Unknown fields, duplicate identities, malformed pins and noncanonical account encodings fail validation. Results are deeply frozen.

## Existing evidence

`fixtures/quote-comparison-sources.json` pins exact local source-file bytes and records their scope. `loadQuoteComparisonFixture(crypto)` verifies those hashes before constructing any comparison:

- All **80** existing cp-amm-sdk 1.5.1 vectors remain synthetic. Expected amounts come from the pinned vector file, never from `quoteAmounts()`. A recorded zero SDK output is mapped to the application's explicit `dust_input` or `dust_output` rejection using recorded input/fee/output values.
- The dated binary observation proves only that recorded program digest observation. It supplies no exact pre-swap account state or full fee/output pair.
- Both directions at seconds **0, 88, 89 and 90** therefore produce **eight explicit missing captured-program requirements**. No new transaction or authority probe fills that gap.

Run the focused matrix, pin, exact-error, corruption, fee-share and async-mutation checks with:

```text
node --test platform/evidence/quote-comparison.test.mjs
node --test platform/quotes/quotes.test.mjs platform/pricing/pricing.test.mjs
```

Passing these tests preserves the captured-program gap. It does not complete B14's guarded application/repository/HTTP port or its fresh Node/D1 quote acceptance.

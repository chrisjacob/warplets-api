# Historical free-cut recovery

Private recovery v2 checks retained Season free-cut records after collection
fulfillment checks and before archive publications. This does not publish a cut,
create a mint admission, or enable financial execution.

Each step verifies one immutable record, attempt, validation, eligibility page,
or final binding. The verifier hashes original canonical bytes, checks original
committed command receipts, reconstructs the original free-stage publication
preimage, and preserves the source revision captured by each attempt. Later
owners, reveals, revocations and source revisions do not replace historical cut
inputs. Original tracked-Genesis coverage is retained through the committed
validation receipt; this remains synthetic local fixture evidence, not proof of
chain completeness. Incomplete older attempts may remain without a final cut.

The indexed eligibility pages must equal their sealed source records and remain
globally sorted, unique and complete. Final cut pages must match every original
root descriptor, and the complete eligible union must equal the sealed list.
Shared closure helpers preserve the existing page/list hash preimages.

Complete-list hashes use a recovery-private injected streaming digest factory.
Node uses native createHash; pinned workerd uses DigestStream. One invocation
reads at most ten chunks of 1,000 already-validated wallet strings, reconstructs
the exact canonical JSON array preimage, awaits every write, and discards the
stream on failure. No stream state is stored or resumed. An interrupted call
starts the hash again from its first chunk. Target watermark checks bracket the
hash; the normal checkpoint transaction also fences the watermark. Empty lists
hash the two-byte [] preimage without requiring the optional streaming adapter.

The 10,000-holder acceptance includes 100 known local Genesis observations and
9,900 explicitly synthetic external additions, all from actual accepted command
rows. Node and actual D1 replay all 312 semantic steps and match every result
digest. Hashes consume 470,001 bytes through bounded chunks. Measured working
payload includes a 125 KiB checkpoint and its retained serialized copy; it is not
an engine heap measurement. Limits remain 64 total operations per invocation,
256 KiB per SQL batch and 1 MiB working payload. The semantic reader leaves room
for the durable checkpoint transaction. A fresh 108-table Node recovery also
checks original cut evidence before readiness and preserves a later transfer.

Focused commands:

```text
node --test platform/recovery/v2-reconcile-free-cuts.test.mjs platform/recovery/v2-reconcile-collections.test.mjs platform/recovery/v2-restore.test.mjs
node --test platform/edge/test/recovery-free-cut.test.mjs
```

The separate offline legacy-adoption probe under work/ measured exact-byte
Node/workerd hash parity, including a 32 MiB/512-read synthetic source. That
512-read invocation exceeds the recovery continuation budget and is not an
adoption capability. Populated legacy adoption still requires bounded component
and original-preimage audits; these recovery checks do not fabricate historical
admission or fulfillment receipts.

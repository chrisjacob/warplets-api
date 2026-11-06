# Private original mint reconciliation

`createRecoveryV2LegacyMintReconciler` handles one retained historical mint per continuation. It requires the genuine certificate and imported-stage semantic proofs from the same private recovery target watermark. Its `reconcile-legacy-adoption-mints` phase remains unmounted in the main reconciler until the rest of adopted-inventory reconciliation is complete.

The private checkpoint contains `legacyAdoption.mintPrefix`: root ID, ordinal, named admission-page cursor and ten remaining Level quotas. It starts at the original quotas after the exact imported-stage prefix. This is an original-draw prefix, not the historical admission-economics prefix. Each accepted step advances it atomically with the immutable anchor preparation-chain link and the original-mint proof. Caller-supplied facts, prefixes or approval booleans are not public inputs.

The mapper reads bounded actual operation, original receipt, Collect slot/bind, Vault bind event and initial Season Level history. It retrieves the named035root/page and verifies their byte hashes. Original manual or configured policy artifacts must match retained054identities/proofs; configured descriptors must match the exact retained policy/request/result, and every referenced part must have its own retained identity. ArtifactStore verification is followed by independent SHA verification. Mutable owner, traits and current Level are not used as original mint evidence.

The existing27auditor rederives the original request/evidence hashes, ticket/quota selection, immutable slot, original wallet, trait strings, expiry and receipt. Configured draws use the injected pinned beacon verifier and exact original policy transcript. Its summary must equal the immutable anchor's `originalOutcome`.

The durable proof is:

```
phase = legacy-adoption-mint
scope = adoptionId
ordinal = original admission ordinal
itemCount = 1
resultDigest = SHA256(canonicalJSON([
  "v2-legacy-original-mint", adoptionId, ordinal,
  anchor.body_digest, anchor.originalOutcome
]))
```

The proof is committed under the current target watermark. The private returned result includes `mintAudit: {kind: "audited", summary, nextPrefix}` only after that proof/checkpoint CAS succeeds or reconciles a committed response. A later economic/current-graph phase can verify this proof without repeating beacon verification; it must independently establish its own prerequisites. Missing proof children roll back the prefix, and a target change across awaited hashes/artifact reads prevents success.

For the maximum escaped-name policy, duplicate tracking retains SHA256 identities of names from earlier pages instead of all escaped strings. Identical names always reject, and a theoretical SHA collision rejects conservatively. Original strings still feed the unchanged canonical policy transcript and selected traits. At most1536name hashes and25part reads occur per audit. The optimization adds no SQL/object operations or dependency and does not expand any limit.

Working measurements include checkpoint copies, retained anchor/source/prefix facts, SQL transport, original artifacts, the auditor's measured live buffers and wrapper part copies. The existing64operation,256KiB SQL-batch,1MiB working and16KiB phase-context bounds remain mandatory. Original-source revisions remain historical; they are not compared with the current target's source revision.

After all original mints, count/quota closure is checked and recovery deliberately holds with `recovery-legacy-adoption-semantics-incomplete`. Historical admission economics, complete object-chain closure and current asset graph checks are separate prerequisites. This slice claims neither original operator authentication nor payment/chain truth, and never enables financial execution.

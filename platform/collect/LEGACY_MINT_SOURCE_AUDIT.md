# Private original mint source audit composition

`createLegacyMintSourceAudit` joins the B11-38 frozen database reader with B11-27 original mint cryptographic verification. Its request supplies only the sealed 035 root ID, frozen source pin, private prefix/cursor, evaluation clock and references to original private artifacts. It accepts no caller-mapped operation, receipt, current asset, Vault, history, request, result or policy facts.

The wrapper returns the original mint summary and next prefix, source/artifact commitments and `prefixAuthority: false`, `economics: false`, `adoption: false`. This remains a private component. The future durable economic audit must prove prefix reachability and combine admission/economic/source-relation prerequisites. No historical receipt is fabricated, no inventory is activated and no public route is mounted.

## Database and artifact binding

The source reader obtains the actual original mint operation/receipt/evidence digest, immutable Collect slot/bind identity, original Vault bind event and Season initial Level history. Its named 035 root/admission selection requires committed staging and source-seal receipt lineage. Current owner, Level, traits and asset version are intentionally not substituted: later transfer or progression can legitimately change them.

Manual originals use one private JSON artifact containing the exact retained legacy fixture. Missing overwritten manual evidence remains held. The old evidence digest independently binds its original wallet-associated operation, asset, proof, time, ticket, commitment and whitespace-preserving public traits.

Configured originals use a private descriptor:

```text
{format:'legacy-mint-original-policy-v1', inventoryId, policyHash,
 registeredMs, assets:{byteDigest,size},
 traits:{model:{count,pages}, backdrop:{count,pages}, symbol:{count,pages}}}
```

The descriptor's inventory, policy digest and registration time must exactly match the frozen retained database identity. Each part's full artifact identity is derived through the existing `privateIdentity` helper: `private/<byteDigest>.json`, exact size, JSON content type, private visibility and null semantic digest. Descriptor and manual fixture are at most 8 KiB; parts are at most 64 KiB. Every fetch calls the real `ArtifactStore.getVerified`, checks returned identity/size, copies bytes before awaiting, and independently recomputes SHA-256. Canonical descriptor/part bytes are retained originals; mutable `fair_inventories.traits` cannot replace them.

B11-27 rehashes the exact original whole policy transcript from these parts, verifies the original request, pinned beacon signature and deterministic draw, compares retained fair result, and checks the original mint evidence digest/slot/history. The descriptor alone proves none of those economics. Invalid supplied evidence is held with a contradiction reason; absent artifacts have explicit missing-preimage reasons.

After all artifact, signature and summary hashing awaits, the wrapper rechecks the same committed 035 receipt lineage, inventory revision, recovery generation/mode/status, null restore nonce and whole-business watermark. A source change holds without publishing an audit result. The summary digest binds the frozen source digest/pin, original artifact reference, original summary and next prefix.

## Bounds and lifecycle

One settled mint is processed per invocation. The largest configured case uses 21 SQL statements and 26 object reads, or 47 storage operations under the limit of 64. No read hydrates a complete inventory or current policy trait graph. The wrapper loads only the named bounded 035 root/page and releases its raw copies immediately after B11-27 synchronously captures them. Only compact source facts, private references and selected policy metadata remain during streamed policy verification.

The 1 MiB working limit includes the underlying source reader peak, wrapper request/facts/descriptor, root/page transport and copy phases, B11-27 conservative working metric and extra ArtifactStore byte copies. The optional B11-27 `onWorkingBytes` observer synchronously checks aggregate working peaks before continuing to later reads/copies; its callback is per invocation, not global. Observer exceptions stop the audit and abort an open policy digest stream. Existing arithmetic and final `onMeasure` output are preserved. These are conservative serialized-buffer measurements, not engine heap profiling.

The original 600,611-byte escaped-name policy is streamed in the measured bounded parts. This does not relax the active normalized mint policy's 512 KiB limit. Historical artifacts outside the declared original-part limits remain a compatibility hold.

## Acceptance scope

Reference tests use real legacy operations, sealed 035 sources and the actual local immutable artifact store. The optional beacon package is not imported by the reference test graph; its injected synthetic verifier is explicitly fixture-only. Actual D1/R2/workerd acceptance uses the retained round 30,000,000 fixture and installed pinned beacon verifier. It compares complete results with Node, including source digests after aligning independently loaded fixture watermark counts through monotonic increments.

Cases include Genesis/Season originals, later mutable NFT changes, large policy, missing and corrupt originals, a dishonest `verified` artifact response, changed policy descriptor, wrong manual traits, invalid real beacon proof, request/artifact mutation during awaited hashing, and source changes during object or final-summary reads. No external provider is called. All chain/payment provenance remains synthetic; successful verification is historical local evidence correctness only.

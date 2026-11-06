# Local Vault commitments and recovery

Vault accounting covers every reserved position from the original launch, including unminted NFTs. Genesis uses ten tranches of 1,000 positions and cumulative integer ranges. Each Season snapshot contains all 1,000 effective launch Levels. Minting, ownership transfer, later progression and Season expiry do not restart historical vesting or change a launch denominator.

These are local recorded-evidence tools. No function signs, funds or broadcasts a claim. A restored owner observation is historical evidence, not a fresh chain-ownership verification.

## Private liability component

`createVaultLiabilityManifest` accepts canonical JSON bytes containing `marketId`, `activatedMs`, `originalUnits`, `inventoryCommitment` and `seasons`. A Season contains `id`, `startsMs` and 1,000 `levels`. The component derives budgets from original supply and active Season weight. Its 64 KiB bound supports at most twelve Season snapshots without creating 10,000 per-launch Genesis rows.

`verifyVaultLiabilityManifest` requires an independently retained SHA-256 digest and recomputes budgets, quotas and snapshots. `projectVaultReserve` calculates reserve allocation and vesting only: `claimAuthority` is false and `claimedUnits` is null. Never subtract zero merely because this component omits claim history.

`publicVaultLiabilityCommitment` emits budgets, original activation, reserve counts and digest references. It omits Season Levels, owners, private evidence and reserve-to-asset maps. This SHA-256 commitment is **not** the Foundation Rewards program's Merkle proof. The private component must not be published through a public artifact route.

`createVaultLiabilityArchive({crypto,store})` saves the component through the existing immutable ArtifactStore. Retain its returned pin separately from the object directory. After an unknown write acknowledgement, retry identical input or restore that same pin. A missing object stays pending; corrupted bytes or changed market/inventory scope reject. This API restores the liability component only, not a database or spent-claim ledger.

`createVaultArchiveIndexStore({crypto,store})` adds a compact private index. Its `save` input contains the exact root bytes/digest, liability bytes/digest and source page index. It verifies fifteen required table descriptors covering original collection identities, immutable binding evidence, ownership/progression history and all four Vault tables, then persists the root, liability component and index as immutable objects. Retain the returned index pin independently. `restore(pin)` rebuilds the expected coverage and rejects omitted spent-claim tables even if someone rehashes a shortened index. It references the whole snapshot without duplicating rows. `fullRecoveryVerified` stays false until the separate full v2 restoration completes.

## Complete private recovery

1. Use the existing bounded v2 capture service (`createRecoveryV2Capture`) to capture the complete application database and retained objects. Preserve the root bytes and root digest independently. Keep the source commit and exact migration descriptor. Do not replace the full snapshot with the compact liability component.
2. Call `vaultLiabilityFromRecoveryPage` with `rootBytes`, independently retained `rootDigest`, `marketId` and the explicit `vault_manifests` page index. It verifies the table/index/page path, original snapshot digest and derived budgets. It returns `pinned-liability-page-only`; it does not certify the rest of the graph. The component's inventory commitment references this exact full recovery root.
3. Restore the full root into an empty, isolated database through `createRecoveryV2Restore`. Call `start`, then bounded `step` operations with the last returned revision. Retain the original pin throughout. The v2 service copies and reconciles all allowlisted tables, including `vault_manifests`, `vault_assets`, `vault_observations` and `vault_claim_totals`, before readiness. Missing, inconsistent or conflicting snapshot data must not be repaired by replacing the pin or discarding spent claims.
4. Wait for `restored`; a progress, pending, conflict or held result is not readiness. Original sessions are revoked and leases fenced. Financial execution remains disabled. Reconcile chain ownership and any unresolved external outcome under the later release policy before enabling financial actions.
5. Compare original launch clocks, reserve coordinates, owner observations and cumulative claimed totals. Never replay a historical claim as a new spend. Existing event IDs retain idempotency; changed event bodies conflict. A former owner cannot claim after a recorded transfer, and cumulative claim amounts cannot exceed vested entitlement.

The complete recovery test uses an independently pinned actual v2 capture, restores 185 objects into a fresh SQLite database, compares all four Vault tables, verifies a partial claim before/after transfer, checks a Season claim after expiry, preserves unminted liability without claim authority, and rejects duplicate bindings, former-owner claims and overspending. It does not claim production custody or physical-wallet acceptance.

Run from the repository root:

```text
node --test platform/vault/manifest.test.mjs platform/vault/archive.test.mjs platform/vault/manifest-from-recovery.test.mjs platform/vault/archive-index.test.mjs
node --test platform/vault/recovery.test.mjs
```

Public claim amounts can reveal a concealed Level. Publishing a digest does not solve this protocol-policy conflict; the release dossier must resolve it without silently withholding vested rights.

# Local 2-of-3 custody evaluation

Squads is an evaluated candidate, not an approved production custody provider or configured account. The approved policy still requires a native Solana 2-of-3 admin and receiver. EVM treasury preference remains Splits; no cross-chain bridge or Solana representation of Splits is introduced.

The dedicated `Meme custody source proof` PR workflow builds **unmodified** upstream Squads source at `af94153ff77a28b6effe46b9c94baaa93742b48c` (program package 2.1.0, AGPL-3.0). Agave 3.0.10 is downloaded from the official release and SHA-256 verified before execution. The pinned SDK is `@sqds/multisig` 2.1.4, confined to the QA package. No program binary is redistributed in Git. The workflow compiles from the upstream checkout, uses no secrets and makes no public blockchain requests.

The Linux proof deploys the compiled ELF only into offline Surfpool. Disposable signers create a 2-of-3 vault with no unilateral config authority and a **fixture** one-hour timelock. It rejects an unknown signer, 1-of-3 execution, early execution, unilateral threshold changes and duplicate execution. A successful 2-of-3 vault CPI transfers exactly 25 of 100 local SPL units; total balances remain 100. Program-config state is an explicit synthetic zero-creation-fee fixture. That fee and the one-hour timelock are not production policy.

```text
# Linux, after the pinned source build:
MEME_SQUADS_ELF=.tmp/squads-build/squads_multisig_program.so pnpm --dir packages/meme-qa test:custody
```

The execution report records the compiled ELF hash and measured payer deltas for custody steps. It is a local proof, not a complete launch budget or a proof that the compiled source equals the deployed mainnet program. The ordinary cross-platform plan test compiles the SDK instructions without RPC. The runtime test fails if Linux/build inputs are unavailable; the dedicated job cannot silently skip it.

Two approved public reads at **2026-10-30 15:20:18 UTC / 31 October 02:20:18 AEDT**, finalized slot **463333446**, observed the mainnet Squads program `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`: ELF SHA-256 `dec8d3e0fae58c7c8f2416e5f67c25e673f047afd6dd2bba4a47e0b29a01d34c`, deployed slot 302582236, **no upgrade authority**. Capture remains ignored and source/binary correspondence remains unverified. Session public-read consumption is now **20 of 50**.

The expanded proof in [PR #117](https://github.com/chrisjacob/warplets-api/pull/117) passed [Linux run 41087980837](https://github.com/chrisjacob/warplets-api/actions/runs/41087980837) at `350e6d5eeccc2d705f5a7bc0dc033977505ce908`. Actual vault CPI creates a Jito distributor with vault admin and vault-owned receiver, detects a changed receiver before funding, restores policy by 2-of-3 proposal, and funds 50 local units. A claimant receives 20 after release independently of the app/vault, and permissionless clawback returns 30 after the approved 365-day boundary. Final balances are vault 55 + earlier receiver 25 + claimant 20 = 100. Unilateral and duplicate execution remain rejected. Clock advancement and keys are local fixtures.

The source-built ELF is `880baa77f257066149f76e1646b1d9343fd8b625fcb4003be2081264ab02375d`, different from the observed mainnet ELF above. The `meme-custody-proof` artifact records execution, provenance and compiler output hash. A local copy is retained in ignored `.tmp/qa-next-stage/custody-vault-distributor/`; GitHub artifacts have limited retention. Session public-read consumption subsequently reached **24/50** including reference fee/rent reads; this CI proof consumed none.

Production still requires the chosen provider/source-to-deployed-binary proof, actual three signer identities and custody addresses, approved timelock/recovery configuration, live receiver/admin read-back, authority checks for Meteora/Jito, operational custody exercises and separate financial/deployment authorization. A test-generated vault never satisfies these gates.

References: [Squads SDK](https://docs.squads.so/main/development/typescript/overview), [pinned source and license](https://github.com/Squads-Protocol/v4/tree/af94153ff77a28b6effe46b9c94baaa93742b48c), [official compiler release](https://github.com/anza-xyz/agave/releases/tag/v3.0.10).

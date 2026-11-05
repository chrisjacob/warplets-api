# Local protocol validation

Run `node --test platform/lab/protocol.test.mjs` from the repository root. The node tests validate the preserved program bytes and compare the SDK's outputs with the PRD for seconds 0 through 90. The fixtures do not require network access, a key file or a Solana connection.

The program archive and manifest come from `packages/meme-qa/fixtures/` at [6dc1b72](https://github.com/chrisjacob/warplets-api/tree/6dc1b72b41fd1fb7f35f9db26ffef8285199c5ef/packages/meme-qa/fixtures). The finalized snapshot was captured at slot 463107036 on 30 October. The DAMM ELF hash begins `967ff9fb`. Its upgrade authority was present. The archive also contains the October distributor. Neither program's source-to-binary match was established by that capture.

The unsigned vector was generated with the reviewed `@meteora-ag/cp-amm-sdk@1.5.1`. To regenerate, use an isolated checkout at the commit above, install the protocol lab's frozen pnpm lockfile with lifecycle scripts disabled, then run:

```
node platform/lab/make-sdk-vector.mjs /absolute/path/to/pinned/checkout/packages/meme-protocol
node --test platform/lab/protocol.test.mjs
```

The new vector uses a one-trillion-base-unit supply, 80% single-sided LP funding and one raw OG unit for initialization. The SDK encoded the 90% opening fee as 89 one-second reductions of one percentage point each. Its decoded initialization selects timestamp activation and OnlyB fees, with the initial price at the lower bound, dynamic fees off and the alpha vault disabled. A permanent-lock instruction for the full prepared liquidity follows in the same transaction. The instruction layout comes from the [pinned program source](https://github.com/MeteoraAg/damm-v2/blob/5398b5c7c534de014091132da37c6478cce671a8/programs/cp-amm/src/base_fee/fee_time_scheduler.rs).

The vector proves SDK construction and encoding. Actual balances, lock ownership and executable swap behavior require execution against the captured ELF. A historical replay also requires a fresh deployed binary/configuration check before any paid pilot. Kamino is absent from the archive. Its treasury fee, same-token support, continuous accrual, recovery behavior and deployed/source parity remain open gates.

On Linux x86-64, install the October QA and SDK dependencies with the frozen reviewed lockfile and lifecycle scripts disabled. Run `node platform/lab/replay-capture.mjs /path/to/october-reference`. The feature-branch CI runs an in-process, offline Surfpool simulator over loopback with read-only repository access and a twelve-minute deadline. The replay checks the zero-OG failure, rollback, actual 80% LP and one-unit OG transfer, full permanent lock, reserved balances, pre-activation rejection, seven actual buy fee boundaries and a sell. Missing dependencies or mismatched balances fail the job. The previous LiteSVM replay stopped during its bundled Token-2022 metadata allocation, before pool initialization. The current harness uses the runtime from the successful October tests.

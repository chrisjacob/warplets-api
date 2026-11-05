# Planning a paid pilot

Run from the repository root:

```text
node platform/costs/cli.mjs --compare
node platform/costs/cli.mjs --reference
node platform/costs/cli.mjs --context-id quote-input.json
node platform/costs/cli.mjs quote-input.json
node --test platform/costs/costs.test.mjs platform/launch/launch.test.mjs
```

`--reference` evaluates all 14 PRD scenarios plus one representative first ATT, with each unsigned source line and payer visible. `--compare` gives the smaller pilot comparison. Each run evaluates freshness at the current time; use `--at EPOCH_MS` only for a dated replay. Both outputs are calculations, with zero chain or payment capability.

**How to read the reference comparison.** A 5 November local evidence packet recorded 42,997,120 lamports for one Kamino farm state, 5,323,840 for one user state, and 1,488,440 for one 165-byte token account. That supports a priced reference component of **0.042997120 SOL** for the founder in the first ATT example. All other founder costs and the current SOL/USD conversion still require quotes. One fresh classic token account per claimant gives 0.148844, 1.48844 or 14.8844 SOL in reference account rent at 100, 1,000 or 10,000 claimants. The currently documented Core protocol fee component alone gives 1.5 SOL for 1,000 asset mints. The sample Season split (900 paid and 100 free mints, zero founder backstop) allocates 1.35 SOL to paid minters and 0.15 SOL to free claimants for that component. Those counts illustrate the comparison, not sales or actual charges. [Kamino fixture and provenance](../lab/KAMINO.md) · [Metaplex Core fee reference](https://www.metaplex.com/docs/smart-contracts/core/faq)

**Quote input.** Use a JSON object with these fields:

| Field | Meaning |
| --- | --- |
| `context` | Network, decimal-string source slot, instruction-set hash, program/configuration hash, funding snapshot hash, blockhash, OG mint, simulation reference and `validUntilMs`. The CLI computes a context ID from these fields. |
| `quotes` | Map each term ID in the reference output to `unit`, decimal-string `amount`, evidence `kind`, `sourceRef`, millisecond observation and expiry. A quote or explicit upper bound must be fresh. Bind native token amounts to the exact context ID, network and slot. OG amounts must name their mint. |
| `accounts` on a rent quote | Evidence of each account's role, byte size, existence and additional rent in lamports per event, with an account-layout reference. Their amounts must sum to the quoted rent. Keep estimated refundable rent separate; budget upfront cash in full. |
| `fx.sol`, `fx.og` | Fresh sourced micro-USD per whole SOL/OG. OG also specifies decimals and mint. Conversion rounds expense ceilings up and receipts down. |
| `parameters` | Explicit scenario counts: fresh ATAs per user, new stakers, daily claimants, paid/free/founder Season mints, backstop count and progression inputs. Optional measured net company fee in basis points drives break-even. Omitted counts stay unknown. |
| `availableCashUsdMicros`, `founderBackstopApprovedUsdMicros` | Separately verified founder cash and any specific backstop spending approval. Omission does not grant spending permission. |

`reference` and `hypothetical` terms can show sensitivity, but cannot complete a quote. A priced subtotal can be partial. Every nonzero term must be sourced with an explicit quantity. A changed program/funding hash, instruction set, blockhash, expired packet or expired conversion stops eligibility. Account for mint-authority actions, retries, execution/fulfillment failures and claimant costs at the named scope; the calculator cannot detect an instruction missing from the caller's simulation.

**Operating decisions.** The calculator and launch planner use one budget policy: target below US$10 and within 20% of verified available cash, require review through US$30 when necessary, and block amounts above US$30 or available cash. The 50% reserve is advisory. The monthly model combines new recurring compute, storage and provider base charges and flags 80% of the US$5 ceiling. Realized receipts remain separate from costs and refundable capital. A monthly zero-demand outcome and break-even trading volume remain unknown until the required expenses, realized mint receipts and collectible fee rate are supplied.

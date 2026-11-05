# QA cost evidence — no funding requested

Four approved public reads at **2026-10-30 15:38:17 UTC / 31 October 02:38:17 AEDT**, finalized Solana slot **463338512**, returned these references:

| Item | Lamports | SOL |
| --- | ---: | ---: |
| One-signature, zero-priority message | 5,000 | 0.000005 |
| Rent exemption, standard 82-byte SPL mint | 1,066,800 | 0.0010668 |
| Rent exemption, standard 165-byte SPL token account | 1,488,440 | 0.00148844 |

This is a current reference, **not** a launch/funding/claim transaction quotation. Message-signing identity checks use zero gas on Base and Solana. No Base write is currently proposed; any future Base write must include execution and L1/data fees separately. No wallet balance, account setting, token ownership or chain state was changed by the reads.

The source-built offline custody proof measured payer deltas: multisig creation 1,833,720 lamports; vault/proposal preparation 4,404,200; two approvals and execution 10,000 each. Total measured custody steps: **6,267,920 lamports (0.00626792 SOL)**. Its program configuration deliberately has a synthetic zero creation fee; these deltas exclude mint/ATA setup and are not a mainnet Squads creation quote. The one-hour timelock is also a test setting.

The eventual itemized packet must price every exact instruction after selecting OG mint, numeric liquidity/fee policy, actual custody, token-account creation/rent, protocol creation fees, priority fees and retry allowance. The approved **one raw OG unit** is a separate token line item, whose display amount depends on the selected OG decimals. Token purchases, liquidity and permanent locks remain separate from gas/rent; they cannot be hidden in a small gas budget. No bridge, NFT purchase, liquidity commitment, provider spending, funding request or financial authorization is implied.

Session public blockchain-read usage is now **24 of 50**, including the one genesis-hash read and two custody-program reads after the first 17 observations. The shared persisted ledger remains authoritative; retries/failures consume attempts and no reset was made. Live provider budgets remain unchanged.

The actual local custody execution artifact is recorded by [CI run 41080182838](https://github.com/chrisjacob/warplets-api/actions/runs/41080182838), with compiled ELF hash `880baa77f257066149f76e1646b1d9343fd8b625fcb4003be2081264ab02375d`. That build differs from the observed deployed-program capture; production source/binary correspondence remains unverified.

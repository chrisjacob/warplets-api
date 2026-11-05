# Mini-app runtime and onboarding

The launchpad reuses the existing 10X context-probe/onboarding patterns and Connect UI. A native shell/iframe probe detects the Farcaster SDK without loading it for ordinary top-level browsers. The SDK signals ready without waiting for market data; capabilities control native wallet availability. Host context never authenticates a FID. Safe-area insets are bounded before application.

Connect offers a native Solana message-proof path when the host advertises it. This follows the pinned 0.3.0 SDK and 2.0.0 official wallet adapter's UTF-8 message/base64 signature contract, then verifies through the existing single-use server challenge. No transaction API is called. External Wallet Standard wallets and Base/web Connect remain available independently. Actual phone/host proofs remain pending.

The short, skippable three-step onboarding preserves browser-storage failure handling, Help replay, reduced-motion behavior and clear illustrative charts. Verified ATTN trading results are public; this is disclosed again before Solana verification. Sharing and trading confer no voting points.

`meme/config/miniapp.manifest.example.json` is an unserved template, not a domain association. Owner association and the approved canonical origin must replace all placeholders before publication. Do not copy another product's association/app ID, expose the current local gateway, relax its frame policy or register remote resources. Public metadata/deep links and signed notification routes are separate delivery packages. Base follows the reviewed web/Base Account surface; no Solana capability is assumed merely because a Base provider exists.

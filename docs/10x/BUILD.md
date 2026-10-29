# Milestones 1–3: local implementation

The owner authorized building all six PRs on 30 October 2026, committing and pushing each, with no deployment. PRs are stacked on the foundation branch. No remote resources, production migrations or paid-budget changes are part of this work.

1. Shared Connect extraction — PR #86: existing UI and clients, compatibility exports, extracted EVM authentication primitives; all 853 app regressions and production build passed.
2. Identity — verified Farcaster sessions, Base wallet linking and Ed25519 Solana reward-wallet proofs in the isolated local database. Same-origin APIs, one-use expiring challenges, host-bound opaque sessions and local-host exposure guards.
3. Persisted rounds, frozen ownership evidence, changeable votes and operator outcomes.
4. Deterministic attribute cycles, streaks and additive boosts.
5. Replayable acquisition-value holding ledger.
6. Frozen settlement inputs, ranked recipients and immutable entitlements.

The proposed policies in the implementation plan are **versioned local working rules**, not approval to activate financial operations. Their numerical examples and behavior are tested. Production review can choose a new version without rewriting historical settlements.

The browser uses the same `@10x/connect` Farcaster/Base/wallet components as the existing products. Solana Wallet Standard message signing extends the Connect modal. A connected EVM address cannot establish a Farcaster FID. Signing uses no transaction. Existing application cookies remain host-scoped; this work does not create cross-subdomain SSO.

## Local development

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --dir meme db:migrate
pnpm --dir meme dev:worker
# Another terminal:
pnpm --dir meme dev
```

The frontend on `127.0.0.1:5194` proxies same-origin API calls to the local Worker on 8797. All launchpad state is under `meme/.wrangler`. Both the local-mode flag and a loopback request hostname are required for participation APIs. Launch execution, funding and claim submission remain disabled. No production secrets are needed to verify ordinary wallet proofs or Farcaster sign-in.

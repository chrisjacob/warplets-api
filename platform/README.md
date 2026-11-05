# 10X.MEME platform

Isolated API-first implementation of the November PRD. Run from this directory with Node 22.16 or later. No installation, wallet, RPC key or provider account is needed.

    node scripts/test-reference.mjs
    node server/start.mjs

Open http://127.0.0.1:4173/api/v1/openapi.json for the available HTTP resources. The local API advertises policy and planned inventory. Live assets require verified evidence and financial actions require the PRD release gates.

Open http://127.0.0.1:4173 for the five product views. Local operator commands under markets, governance, earn, stake, vault and collect accept fixture files. The collection and Earn directories describe the required evidence for admission, fulfillment and reconciliation. The contracts directory contains the generated typed client and OpenAPI document. The separately tested local Cloudflare adapter lives in edge/.

For the full React viewer, run `pnpm install --frozen-lockfile --ignore-scripts` and `pnpm build` inside `site/` before starting the local server. It serves the compiled viewer first, and the install-free reference viewer when a build is absent.

## Optional disposable demo

Run `node scripts/demo.mjs` from this directory, then open http://127.0.0.1:4173/markets. Use `--port=4174` if that port is occupied. This runner binds only loopback, creates an in-memory database, and does not open a browser. Stop with Ctrl+C; restart to reset every local action. It does not modify `.local/preview.sqlite`.

The demo seeds one clearly labeled synthetic ATT/OG market, Genesis and Season inventory with active whitelist stages, three revealed NFTs, an advisory ballot, and illustrative Vault/Farm records. Demo prices are examples, not approved future sale terms. The farm fixture uses the zero-extra-fee target; it is not evidence of live protocol fees. Quote evidence is deliberately absent. All HTML routes display a synthetic-data banner.

To explore member flows, run `node scripts/demo.mjs --wallet=YOUR_SOLANA_PUBLIC_KEY`, then connect that wallet and complete the ordinary message-only sign-in. Pass only a public address. This adds that address to the local fixture ownership and whitelist snapshots; it does not supply a key, create a session, read real wallet holdings, request payment, or send a transaction. Without this option, the fixed fixture owner is for public exploration only. The local Earn stake sample expires five minutes after startup; restart to refresh it. Pending collection requests remain pending until fixture evidence is supplied; the demo does not auto-fulfill financial actions.

Validate the runner with `node --test scripts/demo.test.mjs`. The existing React build is used when available, otherwise the reference viewer is served.

The loopback server keeps an isolated SQLite file in `.local/preview.sqlite`. Its wallet challenge flow verifies Ed25519 message signatures without sending transactions. Challenges bind the wallet, action, origin, chain, nonce and expiry. Sessions use revocable, hashed tokens with strict HttpOnly cookies. Local HTTP is supported only on loopback. Deployment would require HTTPS, Secure cookies, trusted origin configuration and a separately validated storage adapter.

## Boundary with the existing repository

The baseline is released main at ec052a0. Existing root and app Workers use the warplets database; the root Worker also has a one-minute schedule and api.10x.meme route. The bots Worker has its own scheduled jobs, and snap has a separate public route. This directory has no production binding, deploy command, scheduled job or provider credential. Keep its schema, costs and release decisions isolated.

Review source for selective reuse: codex/10x-resilience-review at 6dc1b72. Its evidence versions, account scope, transaction recovery, leases and packet validation are candidates for porting with their original tests. Its launch split, scoring and reward custody policies are superseded. The current implementation is an offline release milestone; custody, funding, deployed-program parity and mint fairness still require independent proof.

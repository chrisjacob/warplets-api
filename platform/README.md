# 10X.MEME platform

Isolated API-first implementation of the November PRD. Run from this directory with Node 22.16 or later. No installation, wallet, RPC key or provider account is needed.

    node --test
    node server/start.mjs

Open http://127.0.0.1:4173/api/v1/openapi.json for the available HTTP resources. The local API advertises policy and planned inventory. Live assets require verified evidence and financial actions require the PRD release gates.

The loopback server keeps an isolated SQLite file in `.local/preview.sqlite`. Its wallet challenge flow verifies Ed25519 message signatures without sending transactions. Challenges bind the wallet, action, origin, chain, nonce and expiry. Sessions use revocable, hashed tokens with strict HttpOnly cookies. Local HTTP is supported only on loopback. Deployment would require HTTPS, Secure cookies, trusted origin configuration and a separately validated storage adapter.

## Boundary with the existing repository

The baseline is released main at ec052a0. Existing root and app Workers use the warplets database; the root Worker also has a one-minute schedule and api.10x.meme route. The bots Worker has its own scheduled jobs, and snap has a separate public route. This directory has no production binding, deploy command, scheduled job or provider credential. Keep its schema, costs and release decisions isolated.

Review source for selective reuse: codex/10x-resilience-review at 6dc1b72. Its evidence versions, account scope, transaction recovery, leases and packet validation are candidates for porting with their original tests. Its launch split, scoring and reward custody policies are superseded. The current implementation is an offline release milestone; custody, funding, deployed-program parity and mint fairness still require independent proof.

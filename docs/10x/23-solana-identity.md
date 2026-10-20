# Local Solana wallet ownership foundation

Implemented 20 October 2026 for PRD §§5.1 and 17.2, following P5 in the [task map](19-prd-task-map.md). This advances identity ownership for future backing; it implements no community votes, eligible-buy credit, rewards, signer custody or transactions. The existing homepage, thesis, collector quotas and evidence gates are unchanged. No deployment or remote resource was created.

## Identity boundary

The existing header Connect and Pages authentication support EVM/Base and Farcaster in the separate Warplets database. Their client wallet address or Farcaster ID is not a trusted identity claim for discovery. Instead, `/wallets` creates an independent, local 10X Solana identity after a verified signature. An existing linked wallet signs in to the same identity; an authenticated identity can add up to ten wallets with individual signatures. A wallet already linked elsewhere cannot be moved or automatically merged.

This is deliberately a Solana foundation, not completion of the PRD's unified EVM/Solana identity. No automatic bridge, account merging or person/Sybil certification exists. Future backing must freeze membership and its effective time alongside the scoring/window version, rather than reattribute historical trades using today's wallet links. A link, click, old holding or signature gives zero votes.

## Proof and session rules

- The server generates a fresh 256-bit nonce and retains the exact message. Its domain, URI, address, `solana:mainnet` chain, action, issue/expiry times and UUID are covered by the signature. Link/unlink messages also name the current identity. Challenges expire after five minutes and bind to the issuing browser session and public origin.
- The server accepts canonical 32-byte Ed25519 signer keys with strict curve/subgroup checks. Strict Ed25519 verification uses the stored message, never a client-supplied replacement. Noncanonical signatures, other accounts, changed chains/domains/actions, expired/future challenges and different cookies fail closed. The chain is the signed authentication scope; this is not a new RPC proof or asset-balance check.
- A D1 transaction claims the challenge once, rechecks active session and ownership, enforces the ten-wallet limit, rotates the session and appends an audit record. A per-attempt random claim tag guards every subsequent write. Racing claims/conflicting owners produce at most one successful admission; a failed database write rolls everything back.
- Anonymous sessions last ten minutes. Signed sessions last twelve hours without sliding extension. Only SHA-256 hashes of random 256-bit session tokens are retained. Cookies are host-only, HttpOnly and SameSite=Strict; the HTTPS preview uses `__Host-tenx_solana` with Secure. HTTP loopback uses a different cookie name. Tokens are not stored in browser local/session storage.
- Public writes require the exact allowlisted Origin, JSON, a custom request header and compatible fetch metadata; there is no cross-origin access grant. Vite overwrites the identity-origin forwarding header using its allowlisted public Host. The Worker still refuses non-loopback/nonlocal runtimes. An operator bearer is neither required nor exposed to the browser.
- Signing out revokes the current browser session and its outstanding challenges. Signed self-unlink requires the removed wallet's fresh signature, retains at least one other linked wallet and revokes every session for that identity. Lost-key removal/recovery, cross-account transfer and a separate signed all-device revocation flow remain future work; there is no operator bypass.
- Challenge creation is atomically capped at ten per browser session per minute and 500 across this local installation per UTC day. These are local abuse/storage limits, separate from unchanged RPC/market allowances. Challenges/sessions and the audit currently remain in the local database; production retention/deletion rules remain release work.

Audit entries retain action, identity/address, challenge ID and hashes of message/signature; raw signatures, private keys and raw session tokens are not persisted. The browser calls only Wallet Standard connect/events/raw-message features, checks the selected account before and after signing, and rejects modified returned message bytes. There is no transaction-signing fallback.

## UI and capability gaps

The My wallets navigation link opens `/wallets` in development only. Users choose an extension and account, prepare a challenge, inspect the exact message and separately request its signature. Expiry, cancellation, account changes, ownership conflicts and unsupported-wallet states are explicit. No request to connect/sign runs automatically on page load.

This version supports Wallet Standard software wallets advertising Solana mainnet and `solana:signMessage`. Hardware/off-chain-only formats, mobile deep links, EVM linking, account merging and actual extension interoperability certification remain incomplete. The in-app browser had no compatible wallet installed; its disconnected state was visually checked. No user wallet was connected or signed during validation.

Primary references reviewed for this work: [Wallet Standard app registration](https://github.com/wallet-standard/wallet-standard/blob/master/packages/core/app/src/wallets.ts), [Solana message feature](https://github.com/anza-xyz/wallet-standard/blob/master/packages/core/features/src/signMessage.ts), [Solana authentication guidance](https://solana.com/docs/frontend/messages-and-auth), [noble Ed25519](https://github.com/paulmillr/noble-curves#ed25519), [D1 transactional batches](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) and [Workers practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/). The raw-message compatibility path is used here; the newer off-chain envelope is not silently interpreted as raw bytes.

## Validation and next work

Local migration `0018_solana_identity.sql` applied to the existing local discovery database. Runtime API schemas are reflected in `discovery/openapi.json`. The full discovery suite passed 240 tests across 27 files, including fourteen identity tests for replay races, cross-owner races, expiry/future timestamps, account/domain/chain/intent binding, rollback injection, session revocation, ownership recovery, wallet/rate caps, CSRF and body bounds. Five browser-adapter tests cover exact bytes, account switches, rejected signatures, unsupported accounts and malformed wallet output. Discovery/app typechecks and the app build/performance budget passed. The app Vitest command exited successfully after its existing Vite shutdown-timeout notice.

The local Vite proxy returned the signed-out identity contract and rejected a foreign-origin write with 403. The running operations checker reported healthy heartbeat/watchdog, verified all three retained rehearsal replays and made zero provider calls. The isolated Workerd/D1 smoke check uses Node-generated disposable Ed25519 keys, runs on its own loopback port/database, verifies real server-side signatures, concurrent replay, linking/recovery, conflict rejection and unlink revocation, then stops only its owned runtime. It never uses a wallet extension, the live app database or a provider.

```powershell
pnpm --dir discovery typecheck
pnpm --dir discovery test
pnpm --dir app test -- src/discovery/walletIdentityClient.test.ts
pnpm --dir app build
pnpm exec tsx scripts/generate-discovery-openapi.ts
pnpm exec tsx scripts/check-solana-identity.ts
pnpm exec tsx scripts/check-discovery-operations.ts
# From discovery/: local migration only
pnpm exec wrangler d1 migrations apply TENX_DB --local --config wrangler.local.jsonc --persist-to .wrangler/local
```

P6 can now build a local finalized eligible-trade ledger and backing rehearsal. Deduplicate by signature/instruction, retain election and identity membership cutoffs, account for sells/round trips, and compare explicitly versioned scoring proposals using offline fixtures. D07 scoring remains unapproved, so live vote/reward credit must stay off. Ten eligible recent discovery tokens is still an unmet target; this identity milestone makes no claim of improving source coverage.

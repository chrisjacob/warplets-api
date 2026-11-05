# Performance, security and UI review — 30 October 2026

Scope: the isolated launchpad on `codex/10x-read-model-hardening`, based on the open #103 stack. No merge, deployment, production data/configuration change, new remote resource, provider allowance or financial action. The temporary warpmoji-only session stopped automatically at **17:27:17 AEDT**; its gateway, Worker, connector and watchdog were verified stopped. Phone wallet testing remains deferred.

## Implemented findings

1. **Lifetime data on every poll.** The UI refreshed every entitlement and the latest 30 history records every 15 seconds. It now requests `GET /api/meme/state?view=today`; History and Rewards are separate lazy views loaded only when opened. The default state response retains its existing history/entitlement contract.
2. **History stopped at 30 rounds.** `GET /api/meme/history` now provides keyset pagination, with simple Load more, Refresh and Retry controls. Dates include the year for older calendar years. Rendering and failed-page recovery are covered on desktop/mobile viewports.
3. **Accumulated rewards need complete groups.** `GET /api/meme/rewards` pages whole campaigns, never arbitrary allocation rows. Each selected campaign contains all of the viewer's eligible finalized allocations through the page's membership cutoff. Integer amounts remain strings and aggregate with BigInt, including amounts above JavaScript's safe integer range. Funding/release/claim states remain distinct, and claims remain disabled.
4. **Account changes during pending sign-in.** Base verification now checks the session recorded at challenge creation before accepting the proof. A different, missing or replaced session fails with 401; failed cross-session attempts do not consume a proof valid for its original session. Connect refreshes also cancel superseded account responses.
5. **Cached private rewards after expiry.** API errors retain their status even when a gateway returns HTML. Revoked/expired access clears private rewards; a late page cannot repopulate a replacement account's view. A response naming another viewer is discarded.
6. **Voting deadline and redundant actions.** A server-time anchor and one timer at the next round boundary close the voting controls promptly, without a per-second render loop. The server still enforces eligibility and the deadline. The currently selected vote cannot be submitted again, and Solana wallet/role selectors are disabled during verification.
7. **Visual density.** Reward rows use a single separator and tighter spacing. Refresh has a larger touch target; long amounts/reasons wrap. The interface retains Today → Rewards → History with brief status text.
8. **Unneeded wallet-provider loading.** Opening Connect no longer loads the Other wallets SDK for a Farcaster/Solana-only session. It loads when requested, or to restore a previously selected Trust connector; both paths have browser regression coverage.

## Read contracts and migration

Both page endpoints accept `limit` (1–20, default 20) and one optional opaque `cursor`. Unknown/duplicate parameters, malformed/oversized cursors and mutations fail closed. Cursor data is untrusted pagination input, not an authorization token. SQL values are bound; every reward query independently filters the authenticated FID. A reward cursor from another account or another endpoint is rejected.

`throughAt` fixes page membership: history uses closing time, and rewards require settlements finalized by that cutoff. Rows can still display their current selection or receipt/release status when read; this is not an immutable financial portfolio snapshot. Refresh restarts membership at the current time. `asOf` describes the response time. Actual claim preparation must recheck current funding, releases, destinations and transaction preconditions.

Additive migration `0014_reward_read_index.sql` backfills a derived per-account campaign index and maintains it on new entitlements, plus an index for historical round paging. It does not update finalized rewards, settlements, source evidence or commitments. A reward page selects at most 20 campaigns and 200 entitlement rows. The original local QA database has not been migrated by this review; fresh migration replay used `.wrangler/read-review-state` only. Apply the additive migration to the isolated QA database before the next supervised session.

The restricted gateway and Worker allowlist include only GET access to the two new endpoints; existing roster, origin, cookie and operator/financial restrictions remain in force.

## Measured local results

Run `pnpm --dir packages/meme-qa benchmark:reads`. The ignored artifact is `.tmp/meme-qa/read-history-load.json`; CI also uploads it. The fixture contains 365 simulated campaigns and 3,650 finalized unfunded entitlements for one synthetic account. Twenty serial samples per endpoint use the actual Worker handler with in-process SQLite; no network/provider/signing calls occur.

| Read | Serialized JSON bytes | Local p95 | D1-style queries/read |
| --- | ---: | ---: | ---: |
| Legacy full state | 1,546,248 | 61.04 ms | 13 |
| Compact Today state | 1,250 | 1.96 ms | 11 |
| First whole-campaign reward page | 85,791 | 5.14 ms | 3 |

Routine poll payload is **99.919% smaller** in this fixture and does not query entitlements. Reads are checked for writes, ledger replay and collection. Exact reward amounts, account isolation, index query plans and migration backfill pass regression checks.

Frontend startup is **69.0 KiB gzip**, within the existing 80 KiB budget; the performance guard now also rejects History/Rewards entering the eager startup graph. A separate local Wrangler startup profile recorded **95.9 ms active time** (151.1 ms profile window), with a 338.02 KiB gzip Worker bundle. These workstation samples are not Cloudflare startup guarantees.

Twenty-two desktop/mobile viewport journeys pass, including real local Ed25519 proof verification, history paging/retry, complete campaign totals, HTML expiry, account-switch races, deadline closure, deferred/restored wallet providers and layout checks. The local launchpad suite passed 76 core tests and four script tests; gateway/recovery tests, frontend/Worker typechecks, import boundaries, fresh migration replay and Worker dry-run bundling also passed. Subsequent CI runs execute the existing actual-program tests on Linux and preserve existing-product/security gates.

The review used the current [Workers best-practices reference](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/) and Workers types `5.20261030.1` without changing dependency pins. Chrome DevTools MCP was unavailable, so this is a code/build/local-browser review, not a Lighthouse, field Core Web Vitals or physical-wallet certification.

Root typechecking and security preflight pass. The production dependency audit retains the same five findings recorded in the [earlier review](REVIEW_2026-10-30.md): two pre-existing ignored high browser-installer advisories, two moderate and one low. The unignored findings concern Satori SVG escaping, Hono Node `serveStatic` path decoding and deepmerge prototype poisoning. No dependency pin or audit exception changed, and passing the existing high-severity gate does not mean those findings are remediated. Their compatibility/exposure review remains part of production readiness.

## Next delivery work

1. Resume supervised iOS Safari **Base/Trust Wallet and Solana** QA with fresh restricted access when the owner is ready. Farcaster sign-in for FID 1431382 and the prior feedback/image fixes are owner-confirmed; actual wallet handoffs, signatures, reconnect/account changes and frozen destinations remain pending. Do not treat viewport or user-agent emulation as a phone pass. A missing Safari Solana provider is an explicit coverage gap, not a reason to bypass proofs.
2. Establish complete finalized ownership and live history/price evidence under explicitly approved sources and unchanged caps. Preserve corrections, replay roots, gaps and stale states. New Helius/Pyth allowances remain zero.
3. Resolve the draft economics and actual custody accounts, verify multisig/program/source/license correspondence, and finish recent-blockhash/nonce/signing/reconciliation adapters. Splits remains the EVM treasury preference; the approved native Solana/Jito 2-of-3 policy is separate.
4. Prepare an itemized controlled-cycle packet only after those gates. Human financial confirmation and separate activation authorization remain required. Observe real +24h…+240h releases; local time advancement does not satisfy this.
5. Finish operational alerts/rota, independent controls, reserve/dispute procedures and production review. Network's November quota rollover/catch-up observation remains a separate follow-up.

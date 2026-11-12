# Compatibility and inbox review — 12 November 2026

Scope: local Windows browsers, disposable fixture databases and synthetic wallet providers. No changes to live wallet ownership, demo preferences, external resources or financial capabilities.

## Inbox investigation and fix

The original intermittent log classified an HTTP 409 as `stale-revision`; it did not retain enough request detail to prove which interleaving caused that particular occurrence. Do not describe that historical event as conclusively reproduced.

The UI did have concrete gaps: it discarded the successful mutation's current preference, depended on a later refetch for the next revision, supplied no explicit refresh action after a conflict, and treated any resolved response (including a non-final 202) as success. The fix cancels outstanding preference reads, validates the response's preference, updates the owner-scoped cache immediately, and invalidates only inbox content after success. A conflict shows **Refresh saved preferences** and requires a fresh user review/action. A non-final or malformed response cannot discard the retained idempotency key. Backend optimistic concurrency and consent rules remain intact; no blind automatic retry was added.

`platform/site/tests/inbox-conflict-qa.mjs` checks delayed reads, rapid enable/disable, a real second-client update followed by conflict, explicit refresh without automatic POST, and a synthetic pending HTTP response retaining the original request key. Fixture sessions are confined to fresh local databases. The 202 is explicitly injected; ordinary reads and consent mutations use the real local API.

## Results

| Configuration | Cases | Result | Limit |
|---|---|---|---|
| Installed Chrome 156.0.8078.81, Windows | Inbox race/recovery suite at 390 and 1280 px | Passed | Headless browser; no Trust Wallet extension exercised |
| Installed Edge 157.0.4341.46, Windows | Same inbox suite; 14 wallet boundary groups at 360/390/768/1440 px | Passed | Synthetic Wallet Standard provider only |
| Installed WebKit 27.2, Windows | Same inbox suite; same four-width wallet boundary suite | Passed | Playwright WebKit, not physical Safari/iOS |
| Pinned Chromium 156.0.8078.4 | Inbox regression; full browser suite; existing notification delivery/revocation/replay/isolation suite | Passed | Local fixture evidence only |
| Frontend unit/component suite | 30 tests | Passed | Scope remains the frontend suite |
| Compatibility and consent repository/HTTP tests | 19 tests | Passed | No funded execution |
| Typecheck and production asset build | Installed pinned dependencies | Passed | Build served by the existing local tunnel; not a deployment |

Wallet boundary groups include registration/removal, unsupported accounts/features, message rejection/tampering, cancellation, account/session identity, explicit second-account selection, permissions reconnect, expired challenges, offline return, private-data separation, keyboard focus, long addresses and reduced motion. Do not sum overlapping suites into a count of independent product features.

## Reproduction

Use the installed pinned dependencies and set `PLAYWRIGHT_MODULE` to the installed Playwright module. `BROWSER_EXE` selects Chrome/Edge/Chromium; for WebKit set `BROWSER_ENGINE=webkit` and omit `BROWSER_EXE`.

- `node platform/site/tests/inbox-conflict-qa.mjs`
- `node platform/site/tests/notifications-runtime-qa.mjs`
- `node platform/site/tests/browser-qa.mjs`
- `node --test platform/site/tests/*.spec.mjs`
- `node --test platform/compatibility/compatibility.test.mjs platform/storage/notification-consent.test.mjs platform/notifications/consent-http.test.mjs`

The extended Edge/WebKit wallet run calls the existing exported `checkWalletBoundaries({browser})` from `platform/site/tests/standard-wallet.mjs` with the selected engine. Result and source hashes are retained in `runs/2026-11-12-manual/inbox-compatibility.json`; detailed local logs remain under `work/`.

## Still unverified

Actual Trust Wallet extension behavior/version-specific permissions, physical iOS/Android wallet return flows and software keyboards, NVDA/VoiceOver/TalkBack output, transaction signing, marketplace execution, hosted environment configuration and funded outcomes remain unverified. Existing physical-device rows must not be promoted by this review. No new browser/extension/provider was installed or enrolled.

For founder review, use [Local demo to release checklist](LOCAL_TO_RELEASE_REVIEW.md), followed by the separately authorized R-stage evidence packets. Do not move beyond local operation merely because these tests passed.

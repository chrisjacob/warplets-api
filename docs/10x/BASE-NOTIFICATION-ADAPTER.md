# Base notification adapter — local evaluation

The launchpad now has an independent Base/web notification queue and permission cache. It reuses the existing apps' payload shape without importing their internals. Farcaster tokens are never treated as Base permission. An exclusively verified Base wallet link, explicit app topic opt-in, and a fresh app-pinned/notification-enabled observation are all required. Wallet changes, stale permission, opt-out and the shared notification pause stop delivery.

Only an injected **fake transport** exists. No Base API key, live status request, notification send, registration or public mutation endpoint was added. The real Base request allowance remains zero. A future real adapter must verify the then-current Base API, project registration, credential handling and user permission flow before separate authorization to deliver.

Fake attempts use persistent per-app pacing (at least 3.1 seconds apart), a configured maximum of 0–20 attempts/minute and consumed-minute accounting. These conservative test limits are not a claim about current provider allowances. Status and send attempts share the same reservation. Farcaster and Base share the maximum of three distinct events per user per UTC day; retries and multiple channels do not create new event slots.

Each order has a stable ID, lease and at most five attempts. Ambiguous acceptance becomes `unknown`, with receipt reconciliation rather than blind resend. Invalid permission disables only the matching observed permission version. Public preferences show both channels as unregistered and cannot enable real delivery. Private health reports queue counts only, never wallet addresses or payloads.

Run the Base and Farcaster queue regressions with `pnpm --dir meme exec tsx --test src/worker/baseNotifications.test.ts src/worker/notifications.test.ts`. Synthetic wallet rows in these isolated SQLite tests do not bypass public cryptographic verification.

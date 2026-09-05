# Stonklets notifications

The admin notification audience selector includes **Stonklets**, scoped to `app_slug = 'stonklets'`. The default destination is https://stonklet.10x.meme/. Farcaster opt-ins arrive through `/webhook/stonklets`; disabling notifications removes a user from the enabled audience.

## Daily Top 3

The root scheduled Worker runs `runStonkletsDailyNotifications` alongside the existing jobs. Enable with `STONKLETS_DAILY_NOTIFICATIONS_ENABLED=true` (configured for production; deployment is still required). Local/default environments without this flag cannot send this campaign.

Sends begin at the NYSE cash-equity close in `America/New_York`: 16:00 on normal trading days and 13:00 on published early-close days. Weekends and full market holidays are excluded. Time-zone conversion handles daylight saving. The published 2026–2028 calendar lives in `app/shared/stonkletsDailyTop.ts`; update it before 2029 and if NYSE announces exceptional closures. Unknown years raise an observable scheduler error rather than guessing a trading session.

Calendar source: https://ir.theice.com/press/news-details/2025/NYSE-Group-Announces-2026-2027-and-2028-Holiday-and-Early-Closings-Calendar/

The ranking uses the same 24-hour chart percentage changes as the app, across bStocks and launched Stonklets. Voting-only Stonklets and assets lacking a finite change are excluded. Highest change wins (including smallest losses when needed); equal changes prefer Stonklets, then lower positive known Stonklet market cap, then symbol for deterministic ordering. Unknown market cap sorts after known values. If fewer than three assets have data, the message reports the actual count; no data means no send and a later retry.

The body is frozen in `notification_job_state` under `stonklets:daily-top:YYYY-MM-DD` on the first eligible batch. The title is `Stonklets`; the body is `Daily Top 3: +123% $TOKENA. +12% $TOKENB. -1% $TOKENC.`. Clicking opens the Stonklets market ordered by 24-hour change, using existing click tracking.

This automatic campaign targets enabled **Farcaster mini-app notification tokens** for Stonklets. It does not send to Warplets registrations, email contacts, or wallets without notification opt-in. Manual admin sends retain the existing channel controls.

Delivery uses a renewable database lease, batches of at most 50 recipients and a 45-second loop budget with 15-second request timeouts. Each recipient has a stable daily notification ID. Existing dispatch tracking excludes delivered/invalid recipients, spaces retries by at least five minutes and caps attempts at six. A later cron continues remaining recipients; disabled registrations are checked on every batch. Existing dispatch/open analytics also record this campaign. No additional database migration is needed.

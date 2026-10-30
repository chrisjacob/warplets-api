# Public verified trading profiles

Every member of a published verified trading cohort has a public FID profile, including traders outside the top 100 or with no sales in the selected window. Reward points remain separate. The profile exposes realized net USD P&L, disposed cost/proceeds, ROI, sale/win counts and per-mint OG gains. Wallet lists, raw histories, authentication details and reward destinations remain absent.

Migration 0023 pins each board's complete source-ID membership. The profile API reads immutable projected metrics with one SELECT; it never replays history or calls providers. Corrections create new boards/profiles and leave historical board links unchanged. Old boards created before cohort membership existed are not retroactively assigned guessed identities. Re-publish a complete source cohort to create profiles.

```text
GET /api/meme/trading/profiles/<fid>?window=24h|30d|all
GET /api/meme/trading/profiles/<fid>?window=all&board=board:<hash>
```

Profiles without a published top-100 rank say so rather than inventing a global position. P&L cards can be published for all cohort members; rank cards require an actual published rank. Card links carry the FID, period and immutable board. Share lookup can additionally pin the source root, so a historical profile never silently shares a newer result. Publication/rendering remains operator-controlled and private; no unbounded public rendering endpoint is introduced.

Leaders offers FID lookup and profile buttons. Farcaster profiles open in the host when supported, otherwise a normal safe external link. Native host back controls are shown only for a supported capability, with an in-app back button always available. The feature uses FIDs because a verified display-name/avatar source has not been connected under new allowances. No extra provider requests or real social posts are made.

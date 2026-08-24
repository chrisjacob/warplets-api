# Email subscriber social proof

The public `GET /api/email/social-proof` route reads only the D1 projection:

- `email_social_proof_members` provides the deduplicated active subscriber count and eligible Farcaster FIDs.
- `email_social_proof_profiles` stores the small profile projection used by the avatar stack.
- `email_social_proof_state` records reconciliation timing and errors.

No visitor request calls Resend or Neynar.

Confirmed subscriptions update the projection after the Resend synchronization succeeds. Unsubscribe and contact-deletion flows remove the corresponding projection member. The Discord bot's existing ten-minute cron checks the projection and performs a Resend reconciliation only when the last successful reconciliation is at least 24 hours old. A failed reconciliation backs off for one hour.

Best Friend ordering remains a local D1 join. Missing profile images may be hydrated during reconciliation when `NEYNAR_API_KEY` is configured on the Discord bot Worker; otherwise existing `warplets_users` profile data is used.

## Production rollout

1. Apply `0061_email_social_proof_projection.sql` to the production `warplets` D1 database.
2. Deploy the app so visitor requests use the projection and subscription/unsubscribe flows maintain it.
3. Deploy `10x-channel-bots` so its cron performs the daily reconciliation.
4. Optionally configure `NEYNAR_API_KEY` on `10x-channel-bots` to hydrate subscriber FIDs that do not yet have a local profile.
5. After the first bot cron (within ten minutes), verify that the projection count matches the active Resend contact count and that up to 15 profiles are returned.

Apply the D1 migration before either code deployment. Until the first reconciliation, the migration seeds only locally verified subscribers; the daily reconciliation adds legacy Resend-only contacts.

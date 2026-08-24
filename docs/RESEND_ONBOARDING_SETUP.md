# Resend 10X onboarding setup

The code and migration are safe to deploy with onboarding disabled. Migration `0062_resend_onboarding.sql` creates empty tables and does not enrol existing contacts.

## Local setup

1. Apply local D1 migrations:

   ```powershell
   pnpm exec wrangler d1 migrations apply warplets --local
   ```

2. Put development-only values in `app/.dev.vars` (this file is gitignored):

   ```dotenv
   RESEND_API_KEY=re_...
   RESEND_FROM_EMAIL=10X <10x@10x.meme>
   RESEND_ONBOARDING_ENABLED=false
   RESEND_ONBOARDING_AUTOMATION_ID=automation-id-after-provisioning
   RESEND_WEBHOOK_SECRET=whsec_...
   ```

3. Keep `RESEND_ONBOARDING_ENABLED=false` until the Automation and all templates have been reviewed. Local confirmations can safely create queued D1 rows while dispatch remains off.

4. To receive real Resend webhooks locally, start the app tunnel and provision a test webhook with its public origin:

   ```powershell
   $env:ONBOARDING_WEBHOOK_ORIGIN="https://app-local.10x.meme"
   pnpm resend:onboarding:provision -- --test-delays
   ```

   The command above is a dry run. Add `--apply` only after reviewing the graph. Test-delay resources use one-minute delays and are not registered in D1.

## Production rollout

1. Apply migration `0062` before deploying either Worker:

   ```powershell
   pnpm exec wrangler d1 migrations apply warplets --remote
   ```

2. Deploy the app and API Worker while `RESEND_ONBOARDING_ENABLED=false` remains in both Wrangler configurations.

3. Obtain a short-lived admin 2FA session from the existing admin UI/API. In the same PowerShell session set:

   ```powershell
   $env:RESEND_API_KEY="re_..."                # full-access key for provisioning
   $env:RESEND_FROM_EMAIL="10X <10x@10x.meme>"
   $env:ONBOARDING_WEBHOOK_ORIGIN="https://app.10x.meme"
   $env:ONBOARDING_ADMIN_ORIGIN="https://app.10x.meme"
   $env:ADMIN_API_TOKEN="..."
   $env:ADMIN_SESSION_TOKEN="..."
   ```

4. Review the dry run, then provision the production resources:

   ```powershell
   pnpm resend:onboarding:provision
   pnpm resend:onboarding:provision -- --apply
   ```

   The provisioner creates or updates eight versioned/published templates, the schema-validated event, a disabled Automation, and the webhook. It registers the IDs in D1. The returned webhook secret is written to the gitignored `.onboarding-provisioning` directory with restricted permissions. If the webhook already existed, retrieve its signing secret from the Resend dashboard.

5. Configure secrets and variables. The Pages app receives and verifies webhooks; the scheduled `api` Worker dispatches and reconciles events.

   ```powershell
   pnpm --dir app exec wrangler pages secret put RESEND_API_KEY --project-name 10x-app
   pnpm --dir app exec wrangler pages secret put RESEND_WEBHOOK_SECRET --project-name 10x-app
   pnpm exec wrangler secret put RESEND_API_KEY
   ```

   Set `RESEND_ONBOARDING_AUTOMATION_ID` to the provisioned production ID in both `app/wrangler.toml` and root `wrangler.toml`. `RESEND_FROM_EMAIL` is already used by the app and should remain configured there. Keep both enable flags false.

6. Provision a separate `--test-delays` Automation, enable only that test Automation in Resend, and send `10x.onboarding.start.v1` to a controlled test contact with payload `{ "start_step": 0, "onboarding_version": 1 }`. Review all HTML/plain-text emails, unsubscribe behavior, webhooks, and admin telemetry. Disable the test Automation afterward.

7. Confirm the production Automation still has one-minute Welcome and seven one-day delays. Enable it in Resend first. Then change `RESEND_ONBOARDING_ENABLED` to `true` in both Wrangler files and redeploy the app and API Worker.

8. Monitor `/__adminhidden/` under **Email Onboarding**. Completion is recorded only after Resend reports delivery of email 8. Bounces, complaints, suppressions, failed/skipped/cancelled runs, and ambiguous dispatches remain visible for reconciliation.

Never commit `.dev.vars`, API keys, webhook secrets, admin tokens, or `.onboarding-provisioning` output.

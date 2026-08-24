# Warpmoji setup and rollout

Warpmoji is implemented but intentionally defaults to **Shadow** mode. Code changes do not create a Neynar signer, create webhooks, apply remote D1 migrations, or deploy Workers.

## 1. Generate and review the data

The checked-in `0052_warpmoji_catalog.sql` was generated from Unicode Emoji 17.0 and the current 10,000-Warplet FTS database:

```powershell
pnpm warpmoji:generate
```

The generator imports every fully-qualified RGI sequence, folds skin-tone and presentation aliases into canonical pools, scores up to 30 candidates, records score components and reasons, and refreshes migration `0056` from Unicode's median-frequency ranking. Re-running it replaces both generated migrations; review their diffs before committing.

Apply the schema and generated seed locally first:

```powershell
pnpm --dir app exec wrangler d1 migrations apply WARPLETS --local
```

The generated catalog contains roughly 15,000 SQL statements, so its first local import can take several minutes. The `local:tunnel:warplet` launcher runs this same command automatically before starting the app.

For preview, apply migrations `0051` through `0056` before deploying code that calls Warpmoji tables. `0053` adds delivery telemetry, `0054` is an idempotent compatibility backfill for the nine standalone Unicode components, `0055` records curated-seed import provenance, and `0056` adds the Unicode median-frequency review order. Use the preview D1 configured by the Pages/Worker environment. Production remains untouched until the Shadow pilot is accepted.

## 2. Configure local curation access

`/warpmoji` exists only on `warplet-local.10x.meme`. It requires a verified app session whose numeric FID is listed in `WARPMOJI_ADMIN_FIDS`.

The default includes `1129138` (`10xchris.eth`). Add the numeric FID for `warpmoji.eth` as a comma-separated value after that account exists:

```toml
WARPMOJI_ADMIN_FIDS = "1129138,<WARPMOJI_FID>"
```

Start the existing local stack and tunnel, sign in with Farcaster, then open:

```text
https://warplet-local.10x.meme/warpmoji
```

Review queues are ordered by Unicode's published median emoji frequency, including the **No candidates** queue, and every queue/search loads further cursor-paginated groups automatically as the page is scrolled. The highest-scored Warplet is the default winner. Candidate selectors are image-only, use three images per row, and show selected Warplets with a thick green border and removed Warplets with a thick red border. Clicking within an emoji updates a local pending selection without moving the group out of the queue. The first selection made in a different emoji confirms the previous pending group and leaves the new group pending, creating a fast one-group look-behind workflow. Use **Confirm now** to save the final pending group before leaving the page; zero selected Warplets is valid and records that the emoji was reviewed without an approved match. Confirmed emoji can otherwise have up to ten approved matches. For a group with no generated candidates, use its local FTS picker to find a Warplet manually; it follows the same pending workflow. Only approved matches can be returned by APIs or advertised in webhook regexes. **Clean up** removes rejected candidate rows but preserves rejection tombstones in the Removed filter, where they can be restored.

### Preserve local reviews as the production seed

The local D1 database is the curation source of truth while reviewing. Export it regularly, and always export again after the final review and cleanup:

```powershell
pnpm warpmoji:export-curated
```

This creates two checked-in UTF-8 files:

- `seeds/warpmoji/curated-seed.v1.json` is the canonical, versioned seed with a SHA-256 integrity checksum.
- `seeds/warpmoji/curated-seed.v1.sql` is a deterministic, inspectable rendering of that JSON.

The export includes reviewed groups (including groups reviewed with zero matches), approved matches, and active rejection tombstones. It intentionally excludes bot mode, limits, webhook IDs, events, jobs, and other environment-specific operational data. Re-running the export without changing curation produces the same checksum and content.

Validate the seed and your current local catalog without changing a database:

```powershell
pnpm warpmoji:import-curated -- --target local --dry-run
```

Once preview D1 has migrations `0051` through `0056`, run the same command with `--target preview --dry-run` to verify remote catalog compatibility before importing.

When preview is ready, first back it up and apply migrations through `0056`, then replace its curation state from the checked-in seed:

```powershell
pnpm --dir app exec wrangler d1 export warplets_preview --remote --env preview --output ../tmp/warplets-preview-before-warpmoji.sql
pnpm --dir app exec wrangler d1 migrations apply WARPLETS --remote --env preview
pnpm warpmoji:import-curated -- --target preview
```

For the eventual production transfer, back up production, apply migrations through `0056`, verify the committed seed checksum, and use the deliberately guarded command:

```powershell
pnpm --dir app exec wrangler d1 export warplets --remote --output ../tmp/warplets-production-before-warpmoji.sql
pnpm --dir app exec wrangler d1 migrations apply WARPLETS --remote
pnpm warpmoji:import-curated -- --target production --confirm-production IMPORT_WARPMOJI_CURATED_SEED
```

An import resets only Warpmoji curation state and then applies the seed exactly. It does not replace the Unicode catalog, candidates, activity, settings, or bot history. After import, the command verifies the reviewed/approved/rejected counts and records the checksum in `warpmoji_curated_seed_imports`.

Never regenerate `0052_warpmoji_catalog.sql` after reviewing without first exporting the curated seed. If the catalog must change, export first, regenerate and apply the catalog, then re-import this seed and resolve any catalog-version mismatch in preview.

## 3. Create the `warpmoji.eth` managed signer

Use the same Neynar project/API key that will publish replies and likes:

1. Create a Neynar managed signer using the Neynar project/API key that will publish the bot's casts and reactions.
2. Open its approval URL while signed in as `warpmoji.eth`.
3. Wait for signer status `approved` and record its signer UUID and the account's numeric FID.
4. Store these Worker secrets; never put them in `wrangler.toml` or client code:

```powershell
pnpm wrangler secret put NEYNAR_API_KEY
pnpm wrangler secret put NEYNAR_WEBHOOK_SECRET
pnpm wrangler secret put WARPMOJI_SIGNER_UUID
```

Set the public numeric FID in the appropriate Worker environment:

```toml
WARPMOJI_FID = "<numeric FID for warpmoji.eth>"
```

The webhook endpoint is:

```text
https://api.10x.meme/v1/warpmoji/webhooks/neynar
```

Incoming requests are rejected unless their `X-Neynar-Signature` is a valid HMAC-SHA512 signature over the exact raw request body.

## 4. Generate the two webhook subscriptions

After approving some pools, open Warpmoji → Settings and select **Generate webhook shards**. This writes non-overlapping, anchored regex shards containing at most 75 approved aliases. It does not call Neynar.

Create or update webhooks in Neynar using the generated rows:

- Organic shards: one `cast.created.text` filter per shard, `minimum_author_score = 0.5`, and `exclude_author_fids = [<warpmoji FID>]`.
- Mention subscription: `cast.created.mentioned_fids = [<warpmoji FID>]`, with no minimum author score.

Keep webhook IDs/statuses recorded in `warpmoji_webhook_shards`. Verify Neynar accepts the generated regex size before increasing the 75-alias shard limit.

## 5. Shadow, allowlist, then Live

1. Leave mode at **Shadow**. Confirm exact emoji, flags, keycaps, skin tones, and ZWJ sequences are classified correctly without publishing.
2. Confirm text plus emoji and multiple emoji are rejected.
3. Confirm mention delivery wins when the same cast reaches both subscriptions.
4. Run an allowlisted-author pilot by limiting the Neynar subscriptions.
5. Check the Status and Activity sections for rejection reasons, queue health, cap usage, and projected credits.
6. Switch to **Live** only after the pilot succeeds.

Launch defaults are 1 organic reply/user/24h and 200 organic/day, plus 10 mention replies/user/24h and 300 mentions/day. The combined default is 500 and the code-enforced maximum is 900 replies per rolling 24 hours. A successful reply plus like is budgeted at approximately 160 Neynar compute units.

## 6. Telegram, Discord and Agent API

Public matching is available at:

```text
GET /v1/warpmoji/match?emoji=🤓&source=warpmoji_api&trigger=api
```

Telegram accepts an emoji-only message and `/warpmoji <emoji>`. Discord exposes `/warpmoji emoji:<emoji>` after re-running its command-registration script. Bot links carry the documented GA4 UTM taxonomy.

## 7. Verification commands

```powershell
pnpm test
pnpm typecheck
pnpm --dir app test
pnpm --dir app build
pnpm --dir bots build
git diff --check
```

Live webhook publishing, replies, likes and regex acceptance require the real Neynar secrets and external subscriptions, so they cannot be end-to-end verified by the local build alone.

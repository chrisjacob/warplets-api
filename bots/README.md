# 10X Telegram and Discord adapters

One Cloudflare Worker normalizes Telegram webhook updates and Discord HTTP
interactions into the same read-only Agent API commands. It never holds wallet
keys and never submits trades. Personal commands require a one-time bot link
followed by SIWE and explicit confirmation in 10X Warplets.

Both adapters also expose Warpmoji. Telegram accepts a standalone approved
emoji or `/warpmoji <emoji>`; Discord exposes `/warpmoji`. Matching is performed
by the Agent API and returns a UTM-attributed canonical Warplet link.

## Configure

Set the same 32+ character `BOT_SERVICE_TOKEN` secret on both the API Worker and
this Worker. Also configure:

- Telegram: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`
- Discord runtime: `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID`
- Discord runtime and command registration: `DISCORD_BOT_TOKEN`

Register Telegram's webhook at `https://bots.10x.meme/telegram` with the secret
token header. Configure Discord's Interactions Endpoint URL as
`https://bots.10x.meme/discord`; no Gateway or privileged intents are used.

After reviewing the target environment, configure the webhook/commands with
`pnpm --dir bots configure:telegram` and `pnpm --dir bots configure:discord`.
Set `DISCORD_GUILD_ID` for a fast guild-only test registration; omit it for the
global user/guild-install command set.

The first release supports user/guild installs, slash commands, deferred
responses and Components V2 output. Proactive messaging is intentionally not
sent until a user has started/installed the bot and opted into a topic.

## Discord email verification

The Discord adapter also provides native in-Discord email verification for the
single configured 10X server. It does not open an external site:

1. A member clicks **Enter email** and submits a Discord modal.
2. The Worker validates syntax, rejects maintained disposable-provider domains,
   and requires a live MX or address record for the email domain.
3. Resend sends a six-digit code. Codes expire after 10 minutes, allow five
   attempts, have a 60-second resend cooldown, and are limited to five sends per
   member and email per hour.
4. After the code succeeds, the Worker reuses an existing global Resend contact
   or creates one, idempotently adds it to the Discord segment, grants the
   **Verified** role, and writes a masked audit entry to the moderator channel.

Existing Resend contacts are not duplicated and their global unsubscribe state
is never changed. One email can verify only one Discord account. Verification
state and hashed codes live in the `EMAIL_VERIFICATIONS` Durable Object; raw
codes are never stored or logged.

### Hardcoded single-server configuration

| Purpose | Value |
| --- | --- |
| Guild | `1539539851311845416` |
| Verification channel | `1539543771878789140` (`✅｜email-verification`) |
| Moderator log channel | `1539847164585451550` (`✅｜mods-verifications`) |
| Resend segment | `be2dd809-e0bd-4b71-95ac-eb11f68270c4` (`Discord`) |
| Discord role | `Verified` (resolved by name unless an ID is configured) |

### Required secrets and permissions

Configure these Worker secrets in addition to the existing Discord interaction
credentials:

```powershell
pnpm --dir bots wrangler secret put DISCORD_BOT_TOKEN
pnpm --dir bots wrangler secret put EMAIL_VERIFICATION_SECRET
pnpm --dir bots wrangler secret put RESEND_API_KEY
pnpm --dir bots wrangler secret put RESEND_FROM_EMAIL
```

`EMAIL_VERIFICATION_SECRET` must be at least 32 random characters.
`RESEND_FROM_EMAIL` should be a sender on a verified Resend domain, for example
`10X Meme <10x@10x.meme>`. Optionally set `DISCORD_VERIFIED_ROLE_ID` to avoid
resolving the `Verified` role by name.

The installed bot needs **View Channels**, **Send Messages**, **Read Message
History**, and **Manage Roles**. Place the bot's highest role above `Verified` in
the Discord role hierarchy or Discord will reject role assignment.

### Register and post the panel

Register commands in this guild for immediate availability:

```powershell
$env:DISCORD_APPLICATION_ID = '<application-id>'
$env:DISCORD_BOT_TOKEN = '<bot-token>'
$env:DISCORD_GUILD_ID = '1539539851311845416'
pnpm --dir bots configure:discord
```

After the updated Worker is deployed, run `/setup-email-verification` in the
server as a member with **Manage Server**. The command posts the panel to the
hardcoded verification channel, or updates the existing bot panel instead of
creating a duplicate.

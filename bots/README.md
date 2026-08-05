# 10X Telegram and Discord adapters

One Cloudflare Worker normalizes Telegram webhook updates and Discord HTTP
interactions into the same read-only Agent API commands. It never holds wallet
keys and never submits trades. Personal commands require a one-time bot link
followed by SIWE and explicit confirmation in the Search app.

## Configure

Set the same 32+ character `BOT_SERVICE_TOKEN` secret on both the API Worker and
this Worker. Also configure:

- Telegram: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`
- Discord runtime: `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID`
- Discord command registration: `DISCORD_BOT_TOKEN`

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

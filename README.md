# Warplets API

A Farcaster [Snap](https://docs.farcaster.xyz/snap) hosted on Cloudflare Workers at [api.10x.meme](https://api.10x.meme), deployed via GitHub Actions.

## What it does

**Favourite Colour Poll** - an interactive Farcaster snap that:
1. Shows a poll asking users to pick their favourite colour (Red, Blue, Green, Yellow, Purple)
2. Records the vote durably in Cloudflare D1 (SQL) and updates an aggregated total in Cloudflare KV
3. Displays live poll results as a bar chart with total vote count (read from KV) and a list of all voter usernames (read from D1)
4. Lets users vote again

## Stack

- **[Hono](https://hono.dev/)** - lightweight web framework
- **[@farcaster/snap-hono](https://www.npmjs.com/package/@farcaster/snap-hono)** - `registerSnapHandler` for GET/POST handling and JFS validation
- **[Cloudflare Workers](https://workers.cloudflare.com/)** - edge deployment target
- **[Cloudflare D1](https://developers.cloudflare.com/d1/)** - durable SQLite database (binding: `WARPLETS`)
- **[Cloudflare Workers KV](https://developers.cloudflare.com/kv/)** - edge key-value cache for aggregated poll totals (binding: `WARPLETS_KV`)
- **[GitHub Actions](https://github.com/features/actions)** - CI/CD via `cloudflare/wrangler-action`
- **[Localflare](https://localflare.dev/)** - local dashboard for inspecting D1 and KV during development

## How votes are stored

```
User presses a colour button
        |
        v
POST /  (FID included in signed payload)
        |
        +- D1: upsert user (fid + username looked up from Farcaster API)
        +- D1: insert vote row  (user_id, poll_option, timestamp)
        +- D1: SELECT COUNT(*) per option  --> KV: write poll_results JSON
        |
        v
Results page
  - Bar chart   <- aggregated counts from KV (fast, edge-local)
  - Total votes <- sum of KV values
  - Voter list  <- DISTINCT usernames from D1 (always consistent)
```

**Why two stores?**

| | Cloudflare D1 (`WARPLETS`) | Workers KV (`WARPLETS_KV`) |
|---|---|---|
| **What** | Individual vote rows + user records | Aggregated per-option totals |
| **Why** | SQL joins, COUNT, strong consistency | Sub-millisecond edge reads at scale |
| **Reads** | Voter list, analytics | Every results page load |
| **Writes** | Every vote | Every vote (after D1 write) |

## Project structure

```
src/
  app.ts          # Shared snap logic - D1 helpers, KV helpers, Hono app
  index.ts        # Production entrypoint (thin wrapper)
  index.dev.ts    # Dev entrypoint - skips JFS verification, pins base URL
scripts/
  dev-tunnel.mjs  # One-command dev workflow (wrangler + cloudflared + localflare)
migrations/
  0001_init.sql   # Creates users and votes tables
.github/workflows/
  deploy.yml      # CI/CD - applies D1 migrations and deploys on push to main
```

## Local development

### One-command dev workflow

```bash
pnpm dev:tunnel
```

This starts three processes in parallel:
- **`wrangler dev --env dev`** on port 8789 - your Worker with local D1 + KV bindings
- **Cloudflare Tunnel** (`api-dev`) -> stable URL `https://api-dev.10x.meme` - required for Farcaster JFS signature verification
- **Localflare dashboard API** -> `http://localhost:8790`
- **Localflare dashboard UI** -> `https://studio.localflare.dev?port=8790` - live UI for browsing D1 tables and KV keys

### Farcaster Snap emulator

With the tunnel running, open the snap in the Farcaster developer emulator:

```
https://farcaster.xyz/~/developers/snaps?url=https%3A%2F%2Fapi-dev.10x.meme%2F
```

### Inspect local data

```bash
pnpm inspect:d1:users     # Show recent users from local D1
pnpm inspect:d1:votes     # Show recent votes from local D1
pnpm inspect:kv:list      # List all keys in local KV
pnpm inspect:kv:poll      # Show current poll_results value from local KV
```

Or open the SQLite file directly in [DB Browser for SQLite](https://sqlitebrowser.org/):
```
.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite
```

Or use the Localflare dashboard (started automatically by `pnpm dev:tunnel`):
```
https://studio.localflare.dev?port=8790
```

### Apply migrations locally

```bash
pnpm wrangler d1 migrations apply warplets --local
```

## Deploying to Cloudflare Workers

### One-time setup

#### 1. Create the D1 database

```bash
wrangler d1 create warplets
```

Copy the `database_id` into `wrangler.toml` under `[[d1_databases]]`.

#### 2. Create the KV namespace

```bash
wrangler kv namespace create WARPLETS_KV
```

Copy the `id` into `wrangler.toml` under `[[kv_namespaces]]`.

#### 3. Apply migrations to production

```bash
wrangler d1 migrations apply warplets --remote
```

### GitHub Secrets

Add the following secrets to your GitHub repository (`Settings -> Secrets and variables -> Actions -> Repository secrets`):

| Secret | Description |
|--------|-------------|
| `CLOUDFLARE_API_TOKEN` | API token with Workers Scripts, D1, KV, and Workers Routes permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID (found on the Workers dashboard sidebar) |

### Cloudflare API token permissions

Create a token at **My Profile -> API Tokens -> Create Token** (custom token) with:

| Resource | Permission |
|---|---|
| Account -> Workers Scripts | Edit |
| Account -> Workers KV Storage | Edit |
| Account -> D1 | Edit |
| Zone -> Workers Routes | Edit |

### Deployment

Push to `main` - GitHub Actions will automatically:
1. Apply D1 migrations (`wrangler d1 migrations apply warplets --remote`)
2. Deploy the Worker (`wrangler deploy`)

Manual deploy:
```bash
pnpm deploy
```

Or trigger via the **Actions** tab -> **Deploy to Cloudflare Workers** -> **Run workflow**.

**Production URL:** `https://api.10x.meme`

## Storage schema

**D1 database (`warplets`, binding: `WARPLETS`)**

```sql
-- One row per Farcaster user who has voted
CREATE TABLE users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  fid        INTEGER NOT NULL UNIQUE,   -- Farcaster ID
  username   TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One row per button press (multiple votes per user are allowed)
CREATE TABLE votes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  poll_option TEXT    NOT NULL,          -- "red" | "blue" | "green" | "yellow" | "purple"
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

**Workers KV (binding: `WARPLETS_KV`)**

| Key | Value |
|-----|-------|
| `poll_results` | `{"red":12,"blue":8,"green":5,"yellow":3,"purple":7}` |

The KV entry is written (or refreshed) after every vote so results page reads are always fast.

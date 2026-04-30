# Snapflare

A Farcaster [Snap](https://docs.farcaster.xyz/snap) hosted on Cloudflare Workers, deployed via GitHub Actions.

## What it does

**Favourite Colour Poll** — an interactive Farcaster snap that:
1. Shows a poll asking users to pick their favourite colour (🔴 Red, 🔵 Blue, 🟢 Green, 🟡 Yellow, 🟣 Purple)
2. Records the vote durably in Cloudflare D1 (SQL) and updates an aggregated total in Cloudflare KV
3. Displays live poll results as a bar chart with total vote count (read from KV) and a list of all voter usernames (read from D1)
4. Lets users vote again

## Stack

- **[Hono](https://hono.dev/)** — lightweight web framework
- **[@farcaster/snap-hono](https://www.npmjs.com/package/@farcaster/snap-hono)** — `registerSnapHandler` for GET/POST handling and validation
- **[Cloudflare Workers](https://workers.cloudflare.com/)** — edge deployment target
- **[Cloudflare D1](https://developers.cloudflare.com/d1/)** — durable SQLite database for users and vote rows
- **[Cloudflare Workers KV](https://developers.cloudflare.com/kv/)** — edge key-value cache for aggregated poll totals
- **[GitHub Actions](https://github.com/features/actions)** — CI/CD via `cloudflare/wrangler-action`

## How votes are stored

```
User presses a colour button
        │
        ▼
POST /  (FID included in signed payload)
        │
        ├─▶ D1: upsert user (fid + username looked up from Farcaster API)
        ├─▶ D1: insert vote row  (user_id, poll_option, timestamp)
        ├─▶ D1: SELECT COUNT(*) per option  ──▶  KV: write poll_results JSON
        │
        ▼
Results page
  • Bar chart      ← aggregated counts from KV  (fast, edge-local)
  • Total votes    ← sum of KV values
  • Voter list     ← DISTINCT usernames from D1  (always consistent)
```

**Why two stores?**

| | Cloudflare D1 | Workers KV |
|---|---|---|
| **What** | Individual vote rows + user records | Aggregated per-option totals |
| **Why** | SQL joins, COUNT, strong consistency | Sub-millisecond edge reads at scale |
| **Reads** | Voter list, analytics | Every results page load |
| **Writes** | Every vote | Every vote (after D1 write) |

## Local development

```bash
pnpm install
pnpm dev
```

The dev server runs on `http://localhost:3003` using Node.js (`@hono/node-server`). **Note:** the Node.js dev server does not have access to Cloudflare D1 or KV bindings — use `wrangler dev` (see below) to develop against real or local-simulated bindings.

Test the GET (poll page):

```bash
curl -sS -H 'Accept: application/vnd.farcaster.snap+json' http://localhost:3003/
```

Test a POST (cast a vote for blue):

```bash
PAYLOAD=$(printf '%s' '{"fid":1,"inputs":{},"nonce":"test","audience":"http://localhost:3003","timestamp":'$(date +%s)'}' \
  | base64 | tr -d '\n' | tr '+/' '-_' | tr -d '=')
curl -sS -X POST -H 'Accept: application/vnd.farcaster.snap+json' \
  -H 'Content-Type: application/json' \
  -d "{\"header\":\"dev\",\"payload\":\"$PAYLOAD\",\"signature\":\"dev\"}" \
  'http://localhost:3003/?colour=blue'
```

### Local development with D1 + KV (wrangler dev)

After completing the one-time setup below, you can run the Worker locally with real bindings:

```bash
# Apply migrations to the local D1 database
wrangler d1 migrations apply snapflare

# Start the local dev server (bindings are simulated by wrangler)
wrangler dev
```

## Deploying to Cloudflare Workers

### Prerequisites

1. A [Cloudflare account](https://dash.cloudflare.com/sign-up)
2. [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed and authenticated (`wrangler login`)

### One-time setup (run locally once before the first deploy)

#### 1. Create the D1 database

```bash
wrangler d1 create snapflare
```

Copy the `database_id` from the output and paste it into `wrangler.toml`:

```toml
[[d1_databases]]
binding       = "DB"
database_name = "snapflare"
database_id   = "<paste-your-database_id-here>"
```

#### 2. Create the KV namespace

```bash
wrangler kv namespace create POLL_KV
```

Copy the `id` from the output and paste it into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "POLL_KV"
id      = "<paste-your-kv-namespace-id-here>"
```

#### 3. Apply the database migrations

```bash
wrangler d1 migrations apply snapflare --remote
```

This creates the `users` and `votes` tables in the remote D1 database.

### Cloudflare API token permissions

Create a Cloudflare API token at **My Profile → API Tokens → Create Token** with the following permissions:

| Permission | Level | Why |
|---|---|---|
| **Workers Scripts: Edit** | Account | Deploy the Worker |
| **Workers KV Storage: Edit** | Account | Create/write KV namespaces |
| **D1: Edit** | Account | Run D1 migrations and read/write data |
| **Account Settings: Read** | Account | Required by wrangler to resolve account ID |

> **Tip:** Use the _"Edit Cloudflare Workers"_ template as a starting point and add **D1: Edit** manually.

### GitHub Secrets

Add the following secrets to your GitHub repository (`Settings → Secrets and variables → Actions`):

| Secret | Description |
|--------|-------------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with the permissions listed above |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID (found on the Workers dashboard sidebar) |
| `SNAP_PUBLIC_BASE_URL` | The deployed worker URL e.g. `https://snapflare.<subdomain>.workers.dev` |

### Deployment

Push to `main` and GitHub Actions will automatically:
1. Run D1 migrations against the remote database (`wrangler d1 migrations apply snapflare --remote`)
2. Deploy the Worker (`wrangler deploy`)

You can also trigger a manual deploy via the **Actions** tab → **Deploy to Cloudflare Workers** → **Run workflow**.

After the first deploy, your worker URL will be:
```
https://snapflare.<your-subdomain>.workers.dev
```

Verify the deployment:
```bash
curl -H 'Accept: application/vnd.farcaster.snap+json' 'https://snapflare.<subdomain>.workers.dev/'
```

## Storage schema

**D1 database (`snapflare`)**

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

**Workers KV (namespace `POLL_KV`)**

| Key | Value |
|-----|-------|
| `poll_results` | `{"red":12,"blue":8,"green":5,"yellow":3,"purple":7}` |

The KV entry is written (or refreshed) after every vote so results page reads are always fast.


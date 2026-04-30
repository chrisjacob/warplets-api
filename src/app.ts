import { Hono } from "hono";
import { type SnapFunction, type SnapHandlerResult } from "@farcaster/snap";
import { registerSnapHandler } from "@farcaster/snap-hono";

// ---------------------------------------------------------------------------
// Environment bindings (Cloudflare Workers)
// ---------------------------------------------------------------------------

interface Env {
  /** Cloudflare D1 database — stores users and individual vote rows. */
  DB: D1Database;
  /** Workers KV namespace — caches aggregated poll totals for fast edge reads. */
  POLL_KV: KVNamespace;
  /** Optional: override the public base URL (e.g. https://snapflare.xyz.workers.dev). */
  SNAP_PUBLIC_BASE_URL?: string;
}

type AppOptions = {
  skipJFSVerification?: boolean;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLOURS = [
  { id: "red", label: "🔴 Red", color: "red" as const },
  { id: "blue", label: "🔵 Blue", color: "blue" as const },
  { id: "green", label: "🟢 Green", color: "green" as const },
  { id: "yellow", label: "🟡 Yellow", color: "amber" as const },
  { id: "purple", label: "🟣 Purple", color: "purple" as const },
] as const;

const VALID_OPTIONS = new Set<string>(COLOURS.map((c) => c.id));
const KV_POLL_RESULTS_KEY = "poll_results";

// ---------------------------------------------------------------------------
// Env capture
//
// Cloudflare Workers env bindings are constant for the lifetime of an isolate
// (they never change between requests). Capturing them on the first request is
// therefore safe and avoids threading `c.env` through every helper.
// ---------------------------------------------------------------------------

let envBindings: Env | undefined;

// ---------------------------------------------------------------------------
// D1 helpers
// ---------------------------------------------------------------------------

/** Resolve the Farcaster username for a FID via the public quilibrium API. */
async function fetchUsername(fid: number): Promise<string> {
  try {
    const res = await fetch(
      `https://haatz.quilibrium.com/v2/farcaster/user?fid=${fid}`,
    );
    if (!res.ok) return `fid:${fid}`;
    const data = (await res.json()) as Record<string, unknown>;
    const user = data.user as Record<string, unknown> | undefined;
    return (
      (user?.username as string | undefined) ??
      (data.username as string | undefined) ??
      `fid:${fid}`
    );
  } catch {
    return `fid:${fid}`;
  }
}

/**
 * Ensure a row exists in `users` for the given FID, creating one (with a
 * username lookup) if it doesn't. Returns the row's `id`.
 */
async function upsertUser(DB: D1Database, fid: number): Promise<number> {
  const existing = await DB.prepare("SELECT id FROM users WHERE fid = ?")
    .bind(fid)
    .first<{ id: number }>();
  if (existing) return existing.id;

  const username = await fetchUsername(fid);
  const inserted = await DB.prepare(
    "INSERT INTO users (fid, username) VALUES (?, ?) RETURNING id",
  )
    .bind(fid, username)
    .first<{ id: number }>();
  if (!inserted) throw new Error(`Failed to insert user for fid ${fid}`);
  return inserted.id;
}

/** Append a new vote row to `votes`. */
async function recordVote(
  DB: D1Database,
  userId: number,
  option: string,
): Promise<void> {
  await DB.prepare("INSERT INTO votes (user_id, poll_option) VALUES (?, ?)")
    .bind(userId, option)
    .run();
}

/**
 * Recalculate per-option totals from D1 and write the result to KV.
 * Returns the fresh totals so they can be used in the same request.
 */
async function refreshPollResultsKV(
  DB: D1Database,
  POLL_KV: KVNamespace,
): Promise<Record<string, number>> {
  const rows = await DB.prepare(
    "SELECT poll_option, COUNT(*) as count FROM votes GROUP BY poll_option",
  ).all<{ poll_option: string; count: number }>();

  const results: Record<string, number> = Object.fromEntries(
    COLOURS.map((c) => [c.id, 0]),
  );
  for (const row of rows.results) {
    if (row.poll_option in results) results[row.poll_option] = row.count;
  }

  await POLL_KV.put(KV_POLL_RESULTS_KEY, JSON.stringify(results));
  return results;
}

/**
 * Read aggregated poll totals from KV (fast, edge-local).
 * Falls back to all-zero counts if the key has not been written yet.
 */
async function getPollResultsFromKV(
  POLL_KV: KVNamespace,
): Promise<Record<string, number>> {
  const cached = await POLL_KV.get(KV_POLL_RESULTS_KEY);
  if (cached) {
    try {
      return JSON.parse(cached) as Record<string, number>;
    } catch {
      // corrupted value — fall through to defaults
    }
  }
  return Object.fromEntries(COLOURS.map((c) => [c.id, 0]));
}

/**
 * Return a deduplicated, sorted list of usernames of everyone who has voted
 * (queried from D1 so it is always consistent).
 */
async function getVoterUsernames(DB: D1Database): Promise<string[]> {
  const rows = await DB.prepare(
    "SELECT DISTINCT u.username" +
      " FROM votes v JOIN users u ON v.user_id = u.id" +
      " ORDER BY u.username",
  ).all<{ username: string }>();
  return rows.results.map((r) => r.username);
}

// ---------------------------------------------------------------------------
// URL helper
// ---------------------------------------------------------------------------

function snapBaseUrl(request: Request): string {
  const fromEnv = (
    envBindings?.SNAP_PUBLIC_BASE_URL ?? process.env.SNAP_PUBLIC_BASE_URL
  )?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`.replace(/\/$/, "");
}

// ---------------------------------------------------------------------------
// Snap page builders
// ---------------------------------------------------------------------------

function pollPage(base: string): SnapHandlerResult {
  return {
    version: "2.0",
    theme: { accent: "purple" },
    ui: {
      root: "page",
      elements: {
        page: {
          type: "stack",
          props: {},
          children: [
            "heading",
            "subtext",
            "btn_red",
            "btn_blue",
            "btn_green",
            "btn_yellow",
            "btn_purple",
          ],
        },
        heading: {
          type: "text",
          props: { content: "What's your favourite colour?", weight: "bold" },
        },
        subtext: {
          type: "text",
          props: { content: "Tap a colour to cast your vote!", size: "sm" },
        },
        btn_red: {
          type: "button",
          props: { label: "🔴 Red", variant: "primary" },
          on: {
            press: {
              action: "submit",
              params: { target: `${base}/?colour=red` },
            },
          },
        },
        btn_blue: {
          type: "button",
          props: { label: "🔵 Blue" },
          on: {
            press: {
              action: "submit",
              params: { target: `${base}/?colour=blue` },
            },
          },
        },
        btn_green: {
          type: "button",
          props: { label: "🟢 Green" },
          on: {
            press: {
              action: "submit",
              params: { target: `${base}/?colour=green` },
            },
          },
        },
        btn_yellow: {
          type: "button",
          props: { label: "🟡 Yellow" },
          on: {
            press: {
              action: "submit",
              params: { target: `${base}/?colour=yellow` },
            },
          },
        },
        btn_purple: {
          type: "button",
          props: { label: "🟣 Purple" },
          on: {
            press: {
              action: "submit",
              params: { target: `${base}/?colour=purple` },
            },
          },
        },
      },
    },
  };
}

function resultsPage(
  base: string,
  voteCounts: Record<string, number>,
  voters: string[],
): SnapHandlerResult {
  const totalVotes = Object.values(voteCounts).reduce((a, b) => a + b, 0);
  const bars = COLOURS.map((c) => ({
    label: c.label,
    value: voteCounts[c.id] ?? 0,
    color: c.color,
  }));
  const votersText =
    voters.length > 0
      ? `👥 Voters: ${voters.join(", ")}`
      : "👥 No votes yet";

  return {
    version: "2.0",
    theme: { accent: "purple" },
    ui: {
      root: "page",
      elements: {
        page: {
          type: "stack",
          props: {},
          children: ["heading", "chart", "total", "sep", "voters", "reset"],
        },
        heading: {
          type: "text",
          props: { content: "Poll Results", weight: "bold" },
        },
        chart: {
          type: "bar_chart",
          props: { bars },
        },
        total: {
          type: "text",
          props: {
            content: `${totalVotes} vote${totalVotes === 1 ? "" : "s"} total`,
            size: "sm",
          },
        },
        sep: {
          type: "separator",
          props: {},
        },
        voters: {
          type: "text",
          props: { content: votersText, size: "sm" },
        },
        reset: {
          type: "button",
          props: { label: "Vote Again", variant: "primary" },
          on: {
            press: {
              action: "submit",
              params: { target: `${base}/` },
            },
          },
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Snap handler
// ---------------------------------------------------------------------------

const snap: SnapFunction = async (ctx) => {
  const url = new URL(ctx.request.url);
  const colour = url.searchParams.get("colour");
  const base = snapBaseUrl(ctx.request);
  const { DB, POLL_KV } = envBindings!;

  if (ctx.action.type === "post" && colour !== null && VALID_OPTIONS.has(colour)) {
    // 1. Ensure the voter exists in D1 (look up username on first visit)
    const userId = await upsertUser(DB, ctx.action.fid);

    // 2. Persist the vote in D1
    await recordVote(DB, userId, colour);

    // 3. Recalculate aggregated totals and push to KV cache
    const voteCounts = await refreshPollResultsKV(DB, POLL_KV);

    // 4. Fetch distinct voter usernames from D1 for display
    const voters = await getVoterUsernames(DB);

    return resultsPage(base, voteCounts, voters);
  }

  return pollPage(base);
};

// ---------------------------------------------------------------------------
// Hono app
// ---------------------------------------------------------------------------

export function createApp(options: AppOptions = {}): Hono {
  const app = new Hono();

  // Capture env bindings on the first request (safe: bindings are constant per isolate)
  app.use("*", async (c, next) => {
    if (!envBindings) envBindings = c.env as Env;
    await next();
  });

  registerSnapHandler(app, snap, {
    skipJFSVerification: options.skipJFSVerification,
    // OG image generation (PNG) is disabled here because @resvg/resvg-wasm may
    // behave differently on Cloudflare Workers edge runtime. The `openGraph`
    // option below still sets the <title> and <meta> tags on the browser fallback
    // HTML page (shown when visiting the URL in a regular browser).
    og: false,
    openGraph: {
      title: "Favourite Colour Poll",
      description: "Pick your favourite colour and see the results!",
    },
  });

  return app;
}

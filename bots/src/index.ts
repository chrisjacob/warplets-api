import { Hono } from "hono";
import { ed25519 } from "@noble/curves/ed25519.js";

interface Env {
  TENX_API?: Fetcher;
  API_ORIGIN?: string;
  SEARCH_ORIGIN?: string;
  BOT_SERVICE_TOKEN?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  DISCORD_PUBLIC_KEY?: string;
  DISCORD_APPLICATION_ID?: string;
}

type Provider = "telegram" | "discord";

interface BotIdentity {
  provider: Provider;
  id: string;
  displayName?: string;
  metadata?: Record<string, unknown>;
}

interface NormalizedCommand {
  name: string;
  args: string[];
  identity: BotIdentity;
}

interface TelegramUpdate {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    chat?: { id?: number; type?: string };
    from?: { id?: number; username?: string; first_name?: string; last_name?: string };
  };
}

interface DiscordInteraction {
  id?: string;
  type?: number;
  token?: string;
  application_id?: string;
  guild_id?: string;
  member?: { user?: DiscordUser };
  user?: DiscordUser;
  data?: { name?: string; options?: DiscordOption[] };
}

interface DiscordUser { id?: string; username?: string; global_name?: string }
interface DiscordOption { name?: string; type?: number; value?: string | number | boolean; options?: DiscordOption[] }

const app = new Hono<{ Bindings: Env }>();
const encoder = new TextEncoder();

function apiOrigin(env: Env): string {
  return (env.API_ORIGIN?.trim() || "https://api.10x.meme").replace(/\/$/, "");
}

function searchOrigin(env: Env): string {
  return (env.SEARCH_ORIGIN?.trim() || "https://search.10x.meme").replace(/\/$/, "");
}

function serviceHeaders(env: Env, identity: BotIdentity): Headers {
  const headers = new Headers({ accept: "application/json", "content-type": "application/json" });
  headers.set("x-10x-service-token", env.BOT_SERVICE_TOKEN?.trim() || "");
  headers.set("x-10x-provider", identity.provider);
  headers.set("x-10x-provider-user-id", identity.id);
  return headers;
}

async function apiRequest(env: Env, identity: BotIdentity, path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const url = new URL(path, `${apiOrigin(env)}/`);
  const headers = serviceHeaders(env, identity);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  const request = new Request(url, { ...init, headers });
  const response = env.TENX_API ? await env.TENX_API.fetch(request) : await fetch(request);
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !payload) {
    const nested = payload?.error;
    const message = typeof nested === "object" && nested && "message" in nested ? String((nested as { message?: unknown }).message) : `10X API failed (${response.status})`;
    throw new Error(message);
  }
  return payload;
}

async function registerIdentity(env: Env, identity: BotIdentity): Promise<void> {
  await apiRequest(env, identity, "/v1/bot/registrations", {
    method: "POST",
    body: JSON.stringify({ displayName: identity.displayName, metadata: identity.metadata }),
  });
}

function envelopeData(payload: Record<string, unknown>): unknown {
  return payload.ok === true ? payload.data : payload;
}

function arrayData(payload: Record<string, unknown>): Record<string, unknown>[] {
  const data = envelopeData(payload);
  return Array.isArray(data) ? data.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")) : [];
}

function shortWallet(value: unknown): string {
  const wallet = typeof value === "string" ? value : "";
  return wallet.length > 12 ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : wallet;
}

function formatWarplets(rows: Record<string, unknown>[], origin: string): string {
  if (!rows.length) return "No Warplets found.";
  return rows.slice(0, 8).map((row) => {
    const id = Number(row.token_id);
    const rank = Number.isFinite(Number(row.x10_rank)) ? ` · rank #${Number(row.x10_rank).toLocaleString()}` : "";
    const owner = typeof row.warplet_username_farcaster === "string" && row.warplet_username_farcaster
      ? ` · @${String(row.warplet_username_farcaster).replace(/^@/, "")}`
      : row.warplet_wallet ? ` · ${shortWallet(row.warplet_wallet)}` : "";
    return `#${id} ${String(row.name ?? "Warplet")}${rank}${owner}\n${origin}/?id=${id}&source=bot`;
  }).join("\n\n");
}

function prettyStats(payload: Record<string, unknown>, label: string): string {
  const data = envelopeData(payload);
  const inner = data && typeof data === "object" && "data" in data ? (data as { data?: unknown }).data : data;
  const text = JSON.stringify(inner, null, 2);
  return `10X Warplets — ${label}\n\n${text.length > 3500 ? `${text.slice(0, 3490)}…` : text}`;
}

function helpText(): string {
  return [
    "10X Warplets commands",
    "",
    "/search <terms> — search Warplets",
    "/random — show a random Warplet",
    "/item <token id> — item details",
    "/stats [overview|market|activity|holders]",
    "/favourites — your linked-wallet favourites",
    "/favourite add|remove <token id>",
    "/alerts enable|disable <topic>",
    "/link — securely link a verified wallet",
    "/ask <question> — grounded read-only query",
    "",
    "Trading actions always open the 10X app for review and wallet signature.",
  ].join("\n");
}

function parseNaturalLanguage(question: string): { name: string; args: string[] } {
  const normalized = question.trim();
  const itemMatch = normalized.match(/(?:warplet|item|#)\s*#?(\d{1,4})/i);
  if (itemMatch) return { name: "item", args: [itemMatch[1]] };
  if (/holder|leaderboard/i.test(normalized)) return { name: "stats", args: ["holders"] };
  if (/volume|floor|price|market|listing chart|offer chart/i.test(normalized)) return { name: "stats", args: ["market"] };
  if (/sale|listing|offer|send|activity/i.test(normalized)) return { name: "stats", args: ["activity"] };
  return { name: "search", args: [normalized] };
}

async function executeCommand(env: Env, command: NormalizedCommand): Promise<string> {
  const { identity } = command;
  const name = command.name.toLowerCase().replace(/^\//, "").split("@")[0];
  if (name === "start" || name === "help") {
    await registerIdentity(env, identity);
    return helpText();
  }
  if (name === "ask") {
    const routed = parseNaturalLanguage(command.args.join(" "));
    return executeCommand(env, { ...command, ...routed });
  }
  if (name === "search") {
    const q = command.args.join(" ").trim();
    if (!q) return "Usage: /search <name, trait, wallet or token ID>";
    const payload = await apiRequest(env, identity, `/v1/warplets?q=${encodeURIComponent(q)}&limit=8&sort=rank`);
    return formatWarplets(arrayData(payload), searchOrigin(env));
  }
  if (name === "random") {
    const tokenId = crypto.getRandomValues(new Uint16Array(1))[0] % 10_000;
    const payload = await apiRequest(env, identity, `/v1/warplets/${tokenId}`);
    const data = envelopeData(payload);
    return formatWarplets(data && typeof data === "object" ? [data as Record<string, unknown>] : [], searchOrigin(env));
  }
  if (name === "item") {
    const tokenId = Number.parseInt(command.args[0] ?? "", 10);
    if (!Number.isInteger(tokenId) || tokenId < 0 || tokenId > 9999) return "Usage: /item <0-9999>";
    const payload = await apiRequest(env, identity, `/v1/warplets/${tokenId}`);
    const data = envelopeData(payload);
    return formatWarplets(data && typeof data === "object" ? [data as Record<string, unknown>] : [], searchOrigin(env));
  }
  if (name === "stats") {
    const kind = ["overview", "market", "activity", "holders"].includes(command.args[0]) ? command.args[0] : "overview";
    const payload = await apiRequest(env, identity, `/v1/stats/${kind}`);
    return `${prettyStats(payload, kind[0].toUpperCase() + kind.slice(1))}\n\n${searchOrigin(env)}/stats/${kind}?source=${identity.provider}`;
  }
  if (name === "link") {
    await registerIdentity(env, identity);
    const payload = await apiRequest(env, identity, "/v1/bot/link-challenges", { method: "POST", body: "{}" });
    const data = envelopeData(payload) as { link?: unknown };
    return `Open this one-time link, verify your wallet and explicitly confirm the ${identity.provider} link:\n\n${String(data.link ?? "")}`;
  }
  if (name === "favourites") {
    const payload = await apiRequest(env, identity, "/v1/me/favourites");
    const data = envelopeData(payload) as { tokenIds?: unknown };
    const ids = Array.isArray(data.tokenIds) ? data.tokenIds : [];
    return ids.length ? `Your favourites: ${ids.map((id) => `#${id}`).join(", ")}` : "You have no favourites. Use /link first if your wallet is not linked.";
  }
  if (name === "favourite") {
    const action = command.args[0];
    const tokenId = Number.parseInt(command.args[1] ?? "", 10);
    if ((action !== "add" && action !== "remove") || !Number.isInteger(tokenId) || tokenId < 0 || tokenId > 9999) return "Usage: /favourite add|remove <0-9999>";
    await apiRequest(env, identity, `/v1/me/favourites/${tokenId}`, { method: action === "add" ? "PUT" : "DELETE" });
    return `Warplet #${tokenId} ${action === "add" ? "added to" : "removed from"} your favourites.`;
  }
  if (name === "alerts") {
    const enabled = command.args[0] === "enable" ? true : command.args[0] === "disable" ? false : null;
    const topic = command.args[1] || "announcements";
    if (enabled === null) {
      const payload = await apiRequest(env, identity, "/v1/me/alerts");
      return prettyStats(payload, "Alert preferences");
    }
    await apiRequest(env, identity, "/v1/me/alerts", {
      method: "PUT",
      body: JSON.stringify({ channel: identity.provider, topic, enabled }),
    });
    return `${topic} alerts ${enabled ? "enabled" : "disabled"} for ${identity.provider}.`;
  }
  return helpText();
}

async function constantTimeSecret(provided: string, expected: string): Promise<boolean> {
  if (!provided || !expected || provided.length !== expected.length) return false;
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function telegramSend(env: Env, chatId: number, text: string): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096), disable_web_page_preview: false }),
  });
  if (!response.ok) throw new Error(`Telegram send failed (${response.status})`);
}

app.get("/health", (c) => c.json({ ok: true, service: "10x-channel-bots" }));

app.post("/telegram", async (c) => {
  const verified = await constantTimeSecret(
    c.req.header("x-telegram-bot-api-secret-token") ?? "",
    c.env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? "",
  );
  if (!verified) return c.json({ ok: false }, 401);
  const update = await c.req.json<TelegramUpdate>();
  const message = update.message;
  const chatId = message?.chat?.id;
  const user = message?.from;
  const text = message?.text?.trim() ?? "";
  if (!chatId || !user?.id || !text) return c.json({ ok: true });
  const [commandName, ...args] = text.split(/\s+/);
  const identity: BotIdentity = {
    provider: "telegram",
    id: String(user.id),
    displayName: user.username ? `@${user.username}` : [user.first_name, user.last_name].filter(Boolean).join(" "),
    metadata: { chatId: String(chatId), chatType: message?.chat?.type ?? null, username: user.username ?? null },
  };
  c.executionCtx.waitUntil(
    executeCommand(c.env, { name: commandName, args, identity })
      .then((reply) => telegramSend(c.env, chatId, reply))
      .catch((error) => telegramSend(c.env, chatId, `10X error: ${error instanceof Error ? error.message : "Request failed"}`)),
  );
  return c.json({ ok: true });
});

function hexBytes(value: string): Uint8Array {
  if (!/^[a-f0-9]+$/i.test(value) || value.length % 2) return new Uint8Array();
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16));
}

function flattenDiscordOptions(options: DiscordOption[] = []): string[] {
  const values: string[] = [];
  for (const option of options) {
    if (option.options?.length) values.push(option.name ?? "", ...flattenDiscordOptions(option.options));
    else if (option.value !== undefined) values.push(String(option.value));
  }
  return values.filter(Boolean);
}

async function editDiscordReply(env: Env, interaction: DiscordInteraction, content: string, ephemeral: boolean): Promise<void> {
  const appId = interaction.application_id || env.DISCORD_APPLICATION_ID;
  if (!appId || !interaction.token) throw new Error("Discord interaction credentials are unavailable");
  const response = await fetch(`https://discord.com/api/v10/webhooks/${appId}/${interaction.token}/messages/@original`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      flags: (ephemeral ? 64 : 0) | 32768,
      components: [{ type: 17, accent_color: 65280, components: [{ type: 10, content: content.slice(0, 3900) }] }],
    }),
  });
  if (!response.ok) throw new Error(`Discord response failed (${response.status})`);
}

app.post("/discord", async (c) => {
  const signature = hexBytes(c.req.header("x-signature-ed25519") ?? "");
  const timestamp = c.req.header("x-signature-timestamp") ?? "";
  const publicKey = hexBytes(c.env.DISCORD_PUBLIC_KEY?.trim() ?? "");
  const rawBody = await c.req.text();
  const valid = signature.length === 64 && publicKey.length === 32 && ed25519.verify(signature, encoder.encode(timestamp + rawBody), publicKey);
  if (!valid) return c.text("invalid request signature", 401);
  const interaction = JSON.parse(rawBody) as DiscordInteraction;
  if (interaction.type === 1) return c.json({ type: 1 });
  if (interaction.type !== 2) return c.json({ type: 4, data: { content: "Unsupported interaction", flags: 64 } });
  const user = interaction.member?.user ?? interaction.user;
  if (!user?.id) return c.json({ type: 4, data: { content: "Discord user identity is unavailable", flags: 64 } });
  const commandName = interaction.data?.name ?? "help";
  const args = flattenDiscordOptions(interaction.data?.options);
  const identity: BotIdentity = {
    provider: "discord",
    id: user.id,
    displayName: user.global_name || user.username,
    metadata: { username: user.username ?? null, guildId: interaction.guild_id ?? null },
  };
  const ephemeral = ["favourites", "favourite", "alerts", "link"].includes(commandName);
  c.executionCtx.waitUntil(
    executeCommand(c.env, { name: commandName, args, identity })
      .then((reply) => editDiscordReply(c.env, interaction, reply, ephemeral))
      .catch((error) => editDiscordReply(c.env, interaction, `10X error: ${error instanceof Error ? error.message : "Request failed"}`, true)),
  );
  // Discord only permits EPHEMERAL on a deferred callback. The edit of the
  // original response above opts into Components V2 once the work completes.
  return c.json({ type: 5, data: { flags: ephemeral ? 64 : 0 } });
});

export default app;

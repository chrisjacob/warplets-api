import { validAddress } from "../../../discovery/src/solana";

export type ShortlistMode = "live" | "fixture";
export type ShortlistIdentity = { address: string; name: string; symbol: string; mode?: ShortlistMode };
export type ShortlistEntry = ShortlistIdentity & { chain: "solana"; mode: ShortlistMode; saved_at: string };
export type ShortlistState = { mode: ShortlistMode; entries: ShortlistEntry[]; status: "saved" | "memory" | "invalid"; message: string };
export type ShortlistAction = { type: "save"; token: ShortlistIdentity } | { type: "remove"; address: string } | { type: "clear" };
type LocalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const SHORTLIST_LIMIT = 100;
export const shortlistKey = (mode: ShortlistMode) => `tenx:discovery-shortlist:v1:solana:${mode}`;
const version = "discovery-shortlist-v1";
const keysEqual = (value: object, keys: string[]) => Object.keys(value).sort().join(",") === keys.sort().join(",");

export function parseShortlist(raw: string | null, mode: ShortlistMode): ShortlistEntry[] {
  if (raw === null) return [];
  if (raw.length > 100_000) throw Error("shortlist_size");
  const value = JSON.parse(raw);
  if (!value || !keysEqual(value, ["version", "entries"]) || value.version !== version ||
      !Array.isArray(value.entries) || value.entries.length > SHORTLIST_LIMIT) throw Error("shortlist_format");
  const seen = new Set<string>();
  return value.entries.map((entry: ShortlistEntry) => {
    if (!entry || typeof entry !== "object" || !keysEqual(entry, ["chain", "mode", "address", "name", "symbol", "saved_at"]) ||
        entry.chain !== "solana" || entry.mode !== mode || typeof entry.address !== "string" || entry.address.length > 44 || !validAddress(entry.address) ||
        seen.has(entry.address) || typeof entry.name !== "string" || entry.name.length > 120 || typeof entry.symbol !== "string" || entry.symbol.length > 40 ||
        typeof entry.saved_at !== "string" || !Number.isFinite(Date.parse(entry.saved_at)) || new Date(entry.saved_at).toISOString() !== entry.saved_at) throw Error("shortlist_entry");
    seen.add(entry.address);
    return { chain: entry.chain, mode, address: entry.address, name: entry.name, symbol: entry.symbol, saved_at: entry.saved_at };
  });
}

// This repository stores identities/presentation hints only. Browser storage is
// never evidence and contains no scores, observations, operator tokens or keys.
export function createShortlistRepository(storage: () => LocalStorage) {
  const memory = new Map<ShortlistMode, ShortlistEntry[]>(), memoryOnly = new Set<ShortlistMode>();
  function state(mode: ShortlistMode, entries: ShortlistEntry[], status: ShortlistState["status"], message = ""): ShortlistState {
    return { mode, entries, status, message };
  }
  function read(mode: ShortlistMode): ShortlistState {
    if (memoryOnly.has(mode)) return state(mode, memory.get(mode) ?? [], "memory");
    let raw: string | null;
    try { raw = storage().getItem(shortlistKey(mode)); }
    catch { memoryOnly.add(mode); return state(mode, memory.get(mode) ?? [], "memory"); }
    try {
      const entries = parseShortlist(raw, mode);
      memory.set(mode, entries);
      return state(mode, entries, "saved");
    } catch { return state(mode, [], "invalid"); }
  }
  function change(mode: ShortlistMode, action: ShortlistAction, now = new Date()): ShortlistState {
    // Re-read before applying an explicit, idempotent action, so a stale tab
    // does not casually replace another tab's recently saved list.
    const current = read(mode);
    if (current.status === "invalid" && action.type !== "clear") return current;
    let entries = current.entries, message: string;
    if (action.type === "save") {
      if (action.token.mode && action.token.mode !== mode) return { ...current, message: "Wait for matching live or simulation observations before saving this token." };
      if (entries.some(entry => entry.address === action.token.address)) return current;
      if (entries.length >= SHORTLIST_LIMIT) return { ...current, message: "Saved list is full. Remove a token before adding another." };
      try {
        const entry: ShortlistEntry = { chain: "solana", mode, address: action.token.address, name: action.token.name.slice(0, 120), symbol: action.token.symbol.slice(0, 40), saved_at: now.toISOString() };
        entries = parseShortlist(JSON.stringify({ version, entries: [entry, ...entries] }), mode);
      } catch { return { ...current, message: "Token could not be saved within the local list format or size limit. The existing list is unchanged." }; }
      message = "Token saved for later.";
    } else if (action.type === "remove") {
      entries = entries.filter(entry => entry.address !== action.address);
      message = "Token removed from saved list.";
    } else {
      entries = [];
      message = "Saved list cleared.";
    }
    memory.set(mode, entries);
    if (action.type === "clear") {
      try { storage().removeItem(shortlistKey(mode)); memoryOnly.delete(mode); }
      catch { memoryOnly.add(mode); message = "Temporary list cleared. Browser storage could not be cleared."; }
    } else if (!memoryOnly.has(mode)) {
      try {
        storage().setItem(shortlistKey(mode), JSON.stringify({ version, entries }));
      } catch { memoryOnly.add(mode); }
    }
    return state(mode, entries, memoryOnly.has(mode) ? "memory" : "saved", message);
  }
  return { read, change };
}

const LOCAL_OFFER_DIAGNOSTICS_HOST = "warplet-local.10x.meme";
const LOCAL_OFFER_DIAGNOSTICS_STORAGE_KEY = "10x:warplets:local-offer-diagnostics:v1";
const MAX_LOCAL_OFFER_DIAGNOSTICS = 120;

export type LocalOfferDiagnosticEntry = {
  id: string;
  at: string;
  event: string;
  details: unknown;
};

type Listener = () => void;

let entries: readonly LocalOfferDiagnosticEntry[] = [];
const EMPTY_ENTRIES: readonly LocalOfferDiagnosticEntry[] = [];
let loaded = false;
const listeners = new Set<Listener>();

export function isLocalOfferDiagnosticsEnabled(): boolean {
  return typeof window !== "undefined" && window.location.hostname.toLowerCase() === LOCAL_OFFER_DIAGNOSTICS_HOST;
}

function sanitizeDiagnosticValue(value: unknown, depth = 0, key = ""): unknown {
  if (depth > 6) return "[maximum depth]";
  const normalizedKey = key.toLowerCase();
  if (normalizedKey.includes("signature") || normalizedKey.includes("authorization") || normalizedKey.includes("secret")) {
    return typeof value === "string" ? `[redacted ${value.length} characters]` : "[redacted]";
  }
  if (value instanceof Error) {
    const error = value as Error & { code?: unknown; data?: unknown; cause?: unknown };
    return {
      name: error.name,
      message: error.message,
      code: error.code ?? null,
      data: sanitizeDiagnosticValue(error.data, depth + 1, "data"),
      cause: sanitizeDiagnosticValue(error.cause, depth + 1, "cause"),
    };
  }
  if (typeof value === "bigint") return value.toString();
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitizeDiagnosticValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 60)
        .map(([childKey, childValue]) => [childKey, sanitizeDiagnosticValue(childValue, depth + 1, childKey)]),
    );
  }
  return String(value);
}

function loadEntries(): void {
  if (loaded || !isLocalOfferDiagnosticsEnabled()) return;
  loaded = true;
  try {
    const stored = window.sessionStorage.getItem(LOCAL_OFFER_DIAGNOSTICS_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) as unknown : null;
    if (Array.isArray(parsed)) entries = parsed.slice(-MAX_LOCAL_OFFER_DIAGNOSTICS) as LocalOfferDiagnosticEntry[];
  } catch {
    entries = [];
  }
}

function publish(next: readonly LocalOfferDiagnosticEntry[]): void {
  entries = next;
  try {
    window.sessionStorage.setItem(LOCAL_OFFER_DIAGNOSTICS_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Diagnostics must never interrupt an offer flow when storage is unavailable.
  }
  listeners.forEach((listener) => listener());
}

export function recordLocalOfferDiagnostic(event: string, details: unknown = null): void {
  if (!isLocalOfferDiagnosticsEnabled()) return;
  loadEntries();
  const entry: LocalOfferDiagnosticEntry = {
    id: `${Date.now()}:${Math.random().toString(16).slice(2)}`,
    at: new Date().toISOString(),
    event,
    details: sanitizeDiagnosticValue(details),
  };
  publish([...entries, entry].slice(-MAX_LOCAL_OFFER_DIAGNOSTICS));
}

export function clearLocalOfferDiagnostics(): void {
  if (!isLocalOfferDiagnosticsEnabled()) return;
  loaded = true;
  publish([]);
}

export function subscribeLocalOfferDiagnostics(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLocalOfferDiagnosticsSnapshot(): readonly LocalOfferDiagnosticEntry[] {
  loadEntries();
  return entries;
}

export function getLocalOfferDiagnosticsServerSnapshot(): readonly LocalOfferDiagnosticEntry[] {
  return EMPTY_ENTRIES;
}

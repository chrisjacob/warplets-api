// Browser-only queue shared by cards: scrolling must not start dozens of
// simultaneous chart requests. Cancelled, unmounted cards release their slots.
let active = 0;
const waiting: (() => void)[] = [];
const cached = new Map<string, { body: string; storedAt: number }>();
const CACHE_MS = 60_000;

function cachedResponse(url: string): Response | null {
  const entry = cached.get(url);
  if (!entry) return null;
  if (Date.now() - entry.storedAt >= CACHE_MS) { cached.delete(url); return null; }
  cached.delete(url); cached.set(url, entry);
  return new Response(entry.body, { headers: { "content-type": "application/json" } });
}

export async function fetchStonkletChart(url: string, signal: AbortSignal): Promise<Response> {
  if (signal.aborted) throw new DOMException("Chart request cancelled", "AbortError");
  const hit = cachedResponse(url);
  if (hit) return hit;
  await new Promise<void>((resolve, reject) => {
    const start = () => {
      signal.removeEventListener("abort", cancel);
      active++;
      resolve();
    };
    const cancel = () => {
      const index = waiting.indexOf(start);
      if (index >= 0) waiting.splice(index, 1);
      reject(new DOMException("Chart request cancelled", "AbortError"));
    };
    if (signal.aborted) { cancel(); return; }
    if (active < 3) start();
    else { waiting.push(start); signal.addEventListener("abort", cancel, { once: true }); }
  });
  try {
    const queuedHit = cachedResponse(url);
    if (queuedHit) return queuedHit;
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(url, { credentials: "same-origin", signal });
      if (response.status !== 429 || attempt >= 3) {
        if (!response.ok) return response;
        const body = await response.text();
        if (body.length <= 200_000) {
          cached.set(url, { body, storedAt: Date.now() });
          while (cached.size > 64) cached.delete(cached.keys().next().value!);
        }
        return new Response(body, { status: response.status, headers: response.headers });
      }
      await response.body?.cancel();
      const seconds = Math.min(120, Math.max(1, Number(response.headers.get("retry-after")) || 60));
      await new Promise<void>((resolve, reject) => {
        const cancel = () => { clearTimeout(timer); reject(new DOMException("Chart request cancelled", "AbortError")); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, seconds * 1000);
        if (signal.aborted) cancel();
        else signal.addEventListener("abort", cancel, { once: true });
      });
    }
  } finally {
    active--;
    waiting.shift()?.();
  }
}

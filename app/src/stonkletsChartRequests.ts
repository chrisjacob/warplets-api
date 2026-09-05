// Browser-only queue shared by cards: scrolling must not start dozens of
// simultaneous chart requests. Cancelled, unmounted cards release their slots.
let active = 0;
const waiting: (() => void)[] = [];

export async function fetchStonkletChart(url: string, signal: AbortSignal): Promise<Response> {
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
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(url, { credentials: "same-origin", signal });
      if (response.status !== 429 || attempt >= 3) return response;
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

/** Loopback-only operator transport. Never log its token or raw response body. */
export async function operatorRequest(
  origin,
  token,
  path,
  body,
  method = "POST",
  fetcher = fetch,
) {
  const base = new URL(origin);
  const target = new URL(path, origin);
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) ||
    !["http:", "https:"].includes(base.protocol) ||
    base.origin !== origin ||
    !/^\/api\/meme\/operator\/[A-Za-z0-9/_:.%\-]+$/.test(path) ||
    target.origin !== origin ||
    target.pathname !== path ||
    target.search ||
    target.hash
  )
    throw Error("Exact loopback operator route required");
  if (!["GET", "POST"].includes(method))
    throw Error("Unsupported operator method");
  const response = await fetcher(origin + path, {
    method,
    headers: {
      "content-type": "application/json",
      origin,
      authorization: "Bearer " + token,
    },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60000),
    redirect: "manual",
  });
  if (!response.ok) {
    // Server/gateway bodies can contain HTML or upstream diagnostics. Preserve
    // useful status codes without copying their contents into terminal logs.
    if (response.body) await response.body.cancel();
    throw Error(
      `Operator request failed (${response.status}); inspect local status before retrying`,
    );
  }
  if (!response.body) throw Error("Operator response is empty");
  const reader = response.body.getReader(),
    decoder = new TextDecoder("utf-8", { fatal: true });
  let raw = "",
    bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 524288) {
        await reader.cancel();
        throw Error("Operator response exceeds its limit");
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw Error("Operator response is not valid JSON");
  }
}
export function statusExitCode(report) {
  if (
    !report ||
    report.version !== 1 ||
    report.scope !== "local-preview" ||
    report.productionReady !== false ||
    !report.financialActions ||
    ["launching", "funding", "claims"].some(
      (name) => report.financialActions[name] !== false,
    ) ||
    !["ok", "idle", "paused", "attention"].includes(report.status)
  )
    return 1;
  return report.status === "attention" ? 2 : 0;
}
export function controlRequestBody(saved, target, origin, workspace) {
  if (
    !saved ||
    saved.version !== 1 ||
    saved.target !== target ||
    saved.origin !== origin ||
    saved.workspace !== workspace ||
    !saved.request ||
    typeof saved.request !== "object" ||
    Array.isArray(saved.request)
  )
    throw Error(
      "Control retry file belongs to another local target or worktree",
    );
  return saved.request;
}

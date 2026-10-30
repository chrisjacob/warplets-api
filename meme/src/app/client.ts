export interface Identity {
  walletAddress?: string | null;
  farcasterFid: number | null;
  solanaWallet: string | null;
  baseWallets: string[];
  wallets: { chain: string; address: string; role: string }[];
}
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function boundedResponseJson(
  response: Response,
  maxBytes = 1048576,
) {
  if (!response.body) throw Error("Empty API response");
  const reader = response.body.getReader(),
    decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0,
    raw = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw Error("API response is too large");
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(raw);
}
export async function api(
  path: string,
  body?: unknown,
  method = body == null ? "GET" : "POST",
  signal?: AbortSignal,
) {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 15000);
  try {
    const response = await fetch(path, {
      method,
      signal: controller.signal,
      credentials: "same-origin",
      ...(body != null
        ? {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    });
    let data;
    try {
      data = await boundedResponseJson(response);
    } catch {
      if (!response.ok) throw new ApiError("Request failed", response.status);
      throw Error("Invalid API response");
    }
    if (!response.ok)
      throw new ApiError(
        data && typeof data.error === "string" ? data.error : "Request failed",
        response.status,
      );
    return data;
  } catch (error) {
    if (timedOut) throw Error("Request timed out. Try again.");
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

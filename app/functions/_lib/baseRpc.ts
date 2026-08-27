export interface BaseRpcEnv {
  /** Full provider URL, including any API key. Configure as a Cloudflare secret. */
  BASE_RPC_URL?: string;
}

const PUBLIC_BASE_RPC_URLS = [
  "https://base-rpc.publicnode.com",
  "https://mainnet.base.org",
] as const;

type JsonRpcError = {
  code?: unknown;
  message?: unknown;
};

type JsonRpcResponse = {
  result?: unknown;
  error?: JsonRpcError;
};

type JsonRpcBatchResponse = Array<{
  id?: unknown;
  result?: unknown;
  error?: JsonRpcError;
}>;

type RpcFetch = typeof fetch;

export type BaseRpcOptions = {
  fetcher?: RpcFetch;
  timeoutMs?: number;
  validateResult?: (result: unknown) => boolean;
};

function rpcEndpointLabel(endpoint: string): string {
  try {
    return new URL(endpoint).hostname;
  } catch {
    return "configured-provider";
  }
}

function normalizeRpcUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function getBaseRpcUrls(env?: BaseRpcEnv): string[] {
  const configured = normalizeRpcUrl(env?.BASE_RPC_URL);
  return [...new Set([configured, ...PUBLIC_BASE_RPC_URLS].filter((value): value is string => Boolean(value)))];
}

function rpcErrorMessage(error: JsonRpcError | undefined): string {
  if (!error) return "missing result";
  const code = typeof error.code === "number" || typeof error.code === "string" ? ` ${error.code}` : "";
  const message = typeof error.message === "string" && error.message.trim() ? `: ${error.message.trim()}` : "";
  return `JSON-RPC error${code}${message}`;
}

async function requestWithFailover<T>(
  env: BaseRpcEnv | undefined,
  body: unknown,
  parse: (payload: unknown) => T,
  options: BaseRpcOptions = {},
): Promise<T> {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const failures: string[] = [];

  for (const endpoint of getBaseRpcUrls(env)) {
    const label = rpcEndpointLabel(endpoint);
    try {
      const response = await fetcher(endpoint, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return parse(await response.json());
    } catch (error) {
      failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Base RPC failed across ${failures.length} provider(s): ${failures.join("; ")}`);
}

export async function fetchBaseRpc(
  env: BaseRpcEnv | undefined,
  method: string,
  params: unknown[],
  options: BaseRpcOptions = {},
): Promise<unknown> {
  return requestWithFailover(env, { jsonrpc: "2.0", id: 1, method, params }, (payload) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("invalid JSON-RPC response");
    }
    const response = payload as JsonRpcResponse;
    if (response.error || !("result" in response)) throw new Error(rpcErrorMessage(response.error));
    if (options.validateResult && !options.validateResult(response.result)) {
      throw new Error("invalid result");
    }
    return response.result;
  }, options);
}

export async function fetchBaseRpcBatch(
  env: BaseRpcEnv | undefined,
  requests: Array<{ id: number; method: string; params: unknown[] }>,
  options: BaseRpcOptions = {},
): Promise<JsonRpcBatchResponse> {
  if (requests.length === 0) return [];
  const body = requests.map((request) => ({ jsonrpc: "2.0", ...request }));
  return requestWithFailover(env, body, (payload) => {
    if (!Array.isArray(payload)) throw new Error("invalid JSON-RPC batch response");
    const responses = payload as JsonRpcBatchResponse;
    if (responses.some((response) => response?.error)) {
      const failed = responses.find((response) => response?.error);
      throw new Error(rpcErrorMessage(failed?.error));
    }
    return responses;
  }, options);
}

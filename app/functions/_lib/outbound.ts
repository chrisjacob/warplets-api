interface OutboundPolicy {
  timeoutMs: number;
  retries: number;
  retryDelayMs: number;
  allowHosts: string[];
}

const DEFAULT_POLICY: OutboundPolicy = {
  timeoutMs: 8000,
  retries: 1,
  retryDelayMs: 250,
  allowHosts: ["api.neynar.com", "api.resend.com", "hub-api.neynar.com"],
};

function isRetriableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isRetriableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const name = error.name.toLowerCase();
  return name.includes("abort") || name.includes("timeout") || name.includes("network");
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function enforceAllowedHost(url: string, allowHosts: string[]): void {
  const hostname = new URL(url).hostname.toLowerCase();
  if (!allowHosts.includes(hostname)) {
    throw new Error(`Outbound host not allowed: ${hostname}`);
  }
}

export async function outboundFetch(url: string, init?: RequestInit, policy?: Partial<OutboundPolicy>): Promise<Response> {
  const cfg: OutboundPolicy = { ...DEFAULT_POLICY, ...policy };
  enforceAllowedHost(url, cfg.allowHosts);

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= cfg.retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeout);

      if (response.ok) return response;
      if (!isRetriableStatus(response.status) || attempt === cfg.retries) return response;

      await wait(cfg.retryDelayMs * (attempt + 1));
      continue;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (!isRetriableError(error) || attempt === cfg.retries) {
        throw error;
      }
      await wait(cfg.retryDelayMs * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Outbound request failed");
}

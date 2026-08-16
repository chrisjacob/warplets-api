export type TraitOfferSubmitRetry = {
  attempt: number;
  nextAttempt: number;
  delayMs: number;
  status: number | null;
  responseText: string;
  error: unknown;
};

export type TraitOfferSubmitResult = {
  response: Response;
  responseText: string;
  attempts: number;
};

type SubmitTraitOfferOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  fetchImpl?: typeof fetch;
  onRetry?: (retry: TraitOfferSubmitRetry) => void;
};

const TRANSIENT_SUBMIT_STATUSES = new Set([429, 502, 503, 504]);

export async function submitTraitOfferWithRetry(
  requestBody: string,
  options: SubmitTraitOfferOptions = {},
): Promise<TraitOfferSubmitResult> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 3));
  const baseDelayMs = Math.max(0, Math.floor(options.baseDelayMs ?? 1_000));
  const fetchImpl = options.fetchImpl ?? fetch;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response | null = null;
    let responseText = "";
    try {
      response = await fetchImpl("/api/trait-offers/submit", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: requestBody,
      });
      responseText = await response.text();
      if (!TRANSIENT_SUBMIT_STATUSES.has(response.status) || attempt === maxAttempts) {
        return { response, responseText, attempts: attempt };
      }
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) throw error;
    }

    const delayMs = baseDelayMs * (2 ** (attempt - 1));
    options.onRetry?.({
      attempt,
      nextAttempt: attempt + 1,
      delayMs,
      status: response?.status ?? null,
      responseText,
      error: response ? null : lastError,
    });
    if (delayMs > 0) await new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
  }

  throw lastError instanceof Error ? lastError : new Error("Trait offer submission failed");
}

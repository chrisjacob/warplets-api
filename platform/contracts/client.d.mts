// Generated from the v1 OpenAPI contract. Run node contracts/generate.mjs to update.
export type Meta = { "requestId": string; "policyVersion": string; "asOf": string; "sourceSlot": number | null };
export type Error = { "error": { "code": string; "message": string; "retryable": boolean; "requestId": string; "retryAfter"?: number } };
export type Market = { "id": string; "symbol": string; "ogSymbol": string; "activatedAt": string; "attMint": string; "ogMint": string; "poolAddress": string; "source": "local-fixture"; "chain": "solana"; "status": "scheduled" | "active" | "campaign-ended"; "feeBps": number | null; "executable": false };
export type FeePoint = { "elapsedSeconds": number; "feeBps": number };
export type VaultAllocation = { "marketId": string; "allocated": string; "vested": string; "claimed": string; "claimable": string; "manifestDigest": string };
export type Profile = { "wallet": string; "chain": "solana" };
export type Challenge = { "nonce": string; "message": string; "expiresAt": string };
export interface PlatformClient {
  getPolicy(options?: { headers?: HeadersInit; signal?: AbortSignal; idempotencyKey?: string }): Promise<Record<string, unknown>>;
  listCollections(options?: { headers?: HeadersInit; signal?: AbortSignal; idempotencyKey?: string }): Promise<Record<string, unknown>>;
  getHealth(options?: { headers?: HeadersInit; signal?: AbortSignal; idempotencyKey?: string }): Promise<{ "data": { "status": string; "mode": string; "policyVersion": string }; "meta": Meta }>;
  createWalletChallenge(options: { headers?: HeadersInit; signal?: AbortSignal; idempotencyKey?: string; body: { "wallet": string } }): Promise<{ "data": Challenge; "meta": Meta }>;
  verifyWalletSignature(options: { headers?: HeadersInit; signal?: AbortSignal; idempotencyKey?: string; body: { "nonce": string; "signature": string } }): Promise<{ "data": { "wallet": string }; "meta": Meta }>;
  revokeSession(options?: { headers?: HeadersInit; signal?: AbortSignal; idempotencyKey?: string }): Promise<{ "data": { "revoked": boolean }; "meta": Meta }>;
  getProfile(options?: { headers?: HeadersInit; signal?: AbortSignal; idempotencyKey?: string }): Promise<{ "data": Profile; "meta": Meta }>;
  getWallets(options?: { headers?: HeadersInit; signal?: AbortSignal; idempotencyKey?: string }): Promise<Record<string, unknown>>;
  listMarkets(options?: { headers?: HeadersInit; signal?: AbortSignal; idempotencyKey?: string; query?: { "limit"?: number; "cursor"?: string } }): Promise<{ "items": Array<Market>; "nextCursor": string | null; "snapshotId": string; "meta": Meta }>;
  getMarket(options: { headers?: HeadersInit; signal?: AbortSignal; idempotencyKey?: string; path: { "id": string } }): Promise<{ "data": Market; "meta": Meta }>;
  getFeeSchedule(options?: { headers?: HeadersInit; signal?: AbortSignal; idempotencyKey?: string }): Promise<{ "data": { "points": Array<FeePoint>; "unit": string; "clock": string }; "meta": Meta }>;
  listLaunchPlans(options?: { headers?: HeadersInit; signal?: AbortSignal; idempotencyKey?: string }): Promise<Record<string, unknown>>;
  previewLaunchPlan(options: { headers?: HeadersInit; signal?: AbortSignal; idempotencyKey?: string; body: { "proposedActivation": string; "supplyBaseUnits": string; "activeSeasonWeight": string; "og"?: { "mint": string; "decimals": number; "compatibility": "unknown" | "unsupported" | "reviewed"; "source"?: string; "priceUsdMicros"?: string; "observedAt"?: string }; "history"?: { "observedAt": string; "coversFrom": string; "launches": Array<{ "id": string; "activatedAt": string }> }; "firstPilotCost"?: { "availableCashCents": number; "networkCents": number; "rentCents": number; "protocolCents": number; "retryCents": number; "otherCents": number }; "swapSimulation"?: { "ogSpentUnits": string; "attReceivedUnits": string; "observedAt": string; "source": string } } }): Promise<Record<string, unknown>>;
  listGenesisBallots(options?: { headers?: HeadersInit; signal?: AbortSignal; idempotencyKey?: string }): Promise<Record<string, unknown>>;
  getGenesisBallot(options: { headers?: HeadersInit; signal?: AbortSignal; idempotencyKey?: string; path: { "id": string } }): Promise<{ "data": { "id": string; "status": string; "eligibleWallets": number; "votesCast": number }; "meta": Meta }>;
  castGenesisVote(options: { headers?: HeadersInit; signal?: AbortSignal; idempotencyKey?: string; path: { "id": string }; body: { "choice": "ASAP" | "7" | "14" | "30" } }): Promise<{ "data": { "choice": "ASAP" | "7" | "14" | "30"; "replayed": boolean }; "meta": Meta }>;
  exportEarnManifest(options: { headers?: HeadersInit; signal?: AbortSignal; idempotencyKey?: string; path: { "epoch": string } }): Promise<Record<string, unknown>>;
  getMyEarnProof(options?: { headers?: HeadersInit; signal?: AbortSignal; idempotencyKey?: string; query?: { "tokenId"?: string; "day"?: number } }): Promise<Record<string, unknown>>;
  listActiveEarnActions(options?: { headers?: HeadersInit; signal?: AbortSignal; idempotencyKey?: string }): Promise<Record<string, unknown>>;
  submitEarnContent(options: { headers?: HeadersInit; signal?: AbortSignal; idempotencyKey?: string; body: { "tokenId": string; "url": string } }): Promise<Record<string, unknown>>;
  getEarnLeaderboard(options: { headers?: HeadersInit; signal?: AbortSignal; idempotencyKey?: string; path: { "epoch": string } }): Promise<Record<string, unknown>>;
  getMyEarnSubmissions(options?: { headers?: HeadersInit; signal?: AbortSignal; idempotencyKey?: string; query?: { "cursor"?: number } }): Promise<Record<string, unknown>>;
  getMyEarnClaims(options?: { headers?: HeadersInit; signal?: AbortSignal; idempotencyKey?: string; query?: { "cursor"?: number } }): Promise<Record<string, unknown>>;
  getMyVault(options?: { headers?: HeadersInit; signal?: AbortSignal; idempotencyKey?: string }): Promise<{ "items": Array<{ "id": string; "detail": string }>; "nextCursor": string | null; "snapshotId": string; "meta": Meta }>;
  getNftVault(options: { headers?: HeadersInit; signal?: AbortSignal; idempotencyKey?: string; path: { "id": string } }): Promise<{ "items": Array<VaultAllocation>; "nextCursor": string | null; "snapshotId": string; "meta": Meta } & { "assetId": string; "slot": Record<string, unknown>; "asOf": string }>;
  getStakePositions(options?: { headers?: HeadersInit; signal?: AbortSignal; idempotencyKey?: string }): Promise<Record<string, unknown>>;
  getFarm(options: { headers?: HeadersInit; signal?: AbortSignal; idempotencyKey?: string; path: { "id": string } }): Promise<Record<string, unknown>>;
  getTransaction(options: { headers?: HeadersInit; signal?: AbortSignal; idempotencyKey?: string; path: { "id": string } }): Promise<Record<string, unknown>>;
}
export declare class PlatformApiError extends Error {status:number;code:string;retryable:boolean;requestId?:string}
export declare function createClient(options?:{baseUrl?:string;fetchImpl?:typeof fetch}):PlatformClient;

const DUNE_API_ORIGIN = "https://api.dune.com";
const ANALYTICS_EPOCH = "2026-07-02T00:00:00.000Z";
const STATS_COLLECTION_SLUG = "10xwarplets";
const WARPLETS_TOTAL_SUPPLY = 10_000;
const COLLECTION_CONTRACT = "0x780446dd12e080ae0db762fcd4daf313f3e359de";
const BASE_CHAIN_ID = 8453;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const WALLET_PATTERN = /^0x[a-f0-9]{40}$/;
const HASH_PATTERN = /^0x[a-f0-9]{64}$/;
const DEFAULT_INTERVAL_HOURS = 24;
const DEFAULT_PAGE_SIZE = 1_000;
const DEFAULT_MAX_PAGES = 8;
const DEFAULT_MONTHLY_CREDIT_BUDGET = 1_500;
const DEFAULT_MAX_CREDITS_PER_EXECUTION = 20;
const FAILURE_RETRY_HOURS = 6;
const LEASE_MINUTES = 5;

type DuneQueryKind = "trades" | "transfers";

type DuneQueryDefinition = {
  kind: DuneQueryKind;
  sourceKey: string;
  schemaVersion: string;
  queryId: number;
};

type DuneExecutionRow = {
  execution_id: string;
  source_key: string;
  query_id: number;
  status: string;
  range_start: string;
  range_end: string | null;
  next_offset: number;
  rows_ingested: number;
  rejected_rows: number;
  schema_version: string | null;
  execution_cost_credits: number | null;
  submitted_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  last_error: string | null;
  updated_at: string;
};

type DuneResultPage = {
  executionId: string | null;
  queryId: number | null;
  state: string | null;
  rows: Array<Record<string, unknown>>;
  columnNames: string[];
  totalRowCount: number | null;
  totalResultSetBytes: number | null;
  nextOffset: number | null;
  submittedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  executionCostCredits: number | null;
};

type DuneStatus = {
  executionId: string;
  queryId: number;
  state: string;
  submittedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  executionCostCredits: number | null;
  error: string | null;
};

type DuneUsage = {
  billingPeriodStart: string;
  billingPeriodEnd: string;
  creditsUsed: number;
  creditsIncluded: number | null;
  fetchedAt: string;
};

type ValidatedPage = {
  coverageStart: string;
  coverageEnd: string;
  dataRows: Array<Record<string, unknown>>;
};

export interface DuneAnalyticsEnv {
  WARPLETS: D1Database;
  DUNE_API_KEY?: string;
  DUNE_ENABLED?: string;
  DUNE_EXECUTE_ENABLED?: string;
  DUNE_TRADES_QUERY_ID?: string;
  DUNE_TRANSFERS_QUERY_ID?: string;
  DUNE_TRADES_BACKFILL_QUERY_ID?: string;
  DUNE_TRANSFERS_BACKFILL_QUERY_ID?: string;
  DUNE_EXECUTION_INTERVAL_HOURS?: string;
  DUNE_RESULTS_PAGE_SIZE?: string;
  DUNE_MAX_RESULT_PAGES?: string;
  DUNE_INDEXING_LAG_HOURS?: string;
  DUNE_MONTHLY_CREDIT_BUDGET?: string;
  DUNE_MAX_CREDITS_PER_EXECUTION?: string;
  DUNE_WEBHOOK_SECRET?: string;
}

export type DuneAdvanceOptions = {
  force?: boolean;
  execute?: boolean;
  queryId?: number | null;
  executionId?: string | null;
  backfill?: boolean;
};

export type DuneAdvanceResult = {
  enabled: boolean;
  configured: boolean;
  status: "disabled" | "unconfigured" | "idle" | "pending" | "ingesting" | "complete" | "partial" | "budget_paused";
  queries: Array<{
    kind: DuneQueryKind;
    queryId: number;
    status: string;
    executionId?: string | null;
    rowsIngested?: number;
    coverageEnd?: string | null;
    error?: string | null;
  }>;
  usageAvailable: boolean;
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
  creditsThisMonth: number;
  monthlyCreditBudget: number;
  maxCreditsPerExecution: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asText(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = asText(value);
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function asInteger(value: unknown): number | null {
  const parsed = asNumber(value);
  return parsed !== null && Number.isSafeInteger(parsed) ? parsed : null;
}

function asIsoDate(value: unknown): string | null {
  const text = asText(value);
  if (!text) return null;
  const timestamp = Date.parse(text.endsWith(" UTC") ? `${text.slice(0, -4)}Z` : text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function normalizeWallet(value: unknown): string | null {
  const wallet = asText(value)?.toLowerCase() ?? "";
  return WALLET_PATTERN.test(wallet) && wallet !== ZERO_ADDRESS ? wallet : null;
}

function normalizeHash(value: unknown): string | null {
  const hash = asText(value)?.toLowerCase() ?? "";
  return HASH_PATTERN.test(hash) ? hash : null;
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed)
    ? Math.max(minimum, Math.min(maximum, parsed))
    : fallback;
}

function parsePositiveNumber(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, parsed))
    : fallback;
}

function enabled(value: string | undefined): boolean {
  return /^(?:1|true|yes|on)$/i.test(value?.trim() ?? "");
}

function sanitizeError(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  return text.replace(/\s+/g, " ").trim().slice(0, 1_000) || "Unknown Dune error";
}

function serialize(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

async function tableExists(db: D1Database, table: string): Promise<boolean> {
  try {
    const row = await db.prepare(
      "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1"
    ).bind(table).first<{ found: number }>();
    return row?.found === 1;
  } catch {
    return false;
  }
}

function configuredQueries(
  env: DuneAnalyticsEnv,
  backfill = false,
): DuneQueryDefinition[] {
  const definitions: Array<[DuneQueryKind, string, string, string | undefined]> = [
    [
      "trades",
      "dune:trades",
      "warplets_dune_sales_v1",
      backfill ? env.DUNE_TRADES_BACKFILL_QUERY_ID : env.DUNE_TRADES_QUERY_ID,
    ],
    [
      "transfers",
      "dune:transfers",
      "warplets_dune_transfers_v1",
      backfill ? env.DUNE_TRANSFERS_BACKFILL_QUERY_ID : env.DUNE_TRANSFERS_QUERY_ID,
    ],
  ];
  return definitions.flatMap(([kind, sourceKey, schemaVersion, rawId]) => {
    const queryId = asInteger(rawId);
    return queryId !== null && queryId > 0
      ? [{ kind, sourceKey, schemaVersion, queryId }]
      : [];
  });
}

async function duneFetch(
  env: DuneAnalyticsEnv,
  path: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const apiKey = env.DUNE_API_KEY?.trim();
  if (!apiKey) throw new Error("Dune API key is not configured.");
  const url = new URL(path, DUNE_API_ORIGIN);
  if (url.origin !== DUNE_API_ORIGIN) throw new Error("Refusing an unexpected Dune API origin.");
  const headers = new Headers(init?.headers);
  headers.set("accept", "application/json");
  headers.set("x-dune-api-key", apiKey);
  if (init?.body) headers.set("content-type", "application/json");
  const response = await fetch(url.toString(), {
    ...init,
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  const raw = await response.text();
  let payload: unknown = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = raw;
  }
  if (!response.ok) {
    const record = asRecord(payload);
    const detail =
      asText(record?.error) ??
      asText(record?.message) ??
      asText(record?.detail) ??
      raw.slice(0, 500);
    throw new Error(`Dune API ${response.status}: ${detail || response.statusText}`);
  }
  const record = asRecord(payload);
  if (!record) throw new Error("Dune API returned an invalid JSON response.");
  return record;
}

function parseExecutionError(payload: Record<string, unknown>): string | null {
  const error = asRecord(payload.error);
  return (
    asText(error?.message) ??
    asText(error?.type) ??
    asText(payload.error) ??
    null
  );
}

function parseDuneStatus(payload: Record<string, unknown>): DuneStatus {
  const executionId = asText(payload.execution_id);
  const queryId = asInteger(payload.query_id);
  const state = asText(payload.state);
  if (!executionId || !queryId || !state) {
    throw new Error("Dune status omitted execution_id, query_id, or state.");
  }
  return {
    executionId,
    queryId,
    state,
    submittedAt: asIsoDate(payload.submitted_at),
    startedAt: asIsoDate(payload.execution_started_at),
    completedAt: asIsoDate(payload.execution_ended_at),
    executionCostCredits: asNumber(payload.execution_cost_credits),
    error: parseExecutionError(payload),
  };
}

function parseDuneResultPage(payload: Record<string, unknown>): DuneResultPage {
  const result = asRecord(payload.result);
  const metadata = asRecord(result?.metadata);
  const rows = Array.isArray(result?.rows)
    ? result.rows.map(asRecord).filter((row): row is Record<string, unknown> => row !== null)
    : [];
  const columnNames = Array.isArray(metadata?.column_names)
    ? metadata.column_names
      .map(asText)
      .filter((column): column is string => column !== null)
      .map((column) => column.toLowerCase())
    : [];
  return {
    executionId: asText(payload.execution_id),
    queryId: asInteger(payload.query_id),
    state: asText(payload.state),
    rows,
    columnNames,
    totalRowCount: asInteger(metadata?.total_row_count ?? metadata?.row_count),
    totalResultSetBytes: asInteger(metadata?.total_result_set_bytes ?? metadata?.result_set_bytes),
    nextOffset: asInteger(payload.next_offset),
    submittedAt: asIsoDate(payload.submitted_at),
    startedAt: asIsoDate(payload.execution_started_at),
    completedAt: asIsoDate(payload.execution_ended_at),
    executionCostCredits: asNumber(payload.execution_cost_credits),
  };
}

async function fetchExecutionStatus(
  env: DuneAnalyticsEnv,
  executionId: string,
): Promise<DuneStatus> {
  return parseDuneStatus(await duneFetch(
    env,
    `/api/v1/execution/${encodeURIComponent(executionId)}/status`,
  ));
}

async function fetchExecutionResults(
  env: DuneAnalyticsEnv,
  executionId: string,
  limit: number,
  offset: number,
): Promise<DuneResultPage> {
  return parseDuneResultPage(await duneFetch(
    env,
    `/api/v1/execution/${encodeURIComponent(executionId)}/results?limit=${limit}&offset=${offset}`,
  ));
}

async function fetchLatestQueryResults(
  env: DuneAnalyticsEnv,
  queryId: number,
  limit: number,
): Promise<DuneResultPage> {
  return parseDuneResultPage(await duneFetch(
    env,
    `/api/v1/query/${queryId}/results?limit=${limit}&offset=0`,
  ));
}

async function startQueryExecution(
  env: DuneAnalyticsEnv,
  queryId: number,
): Promise<DuneStatus> {
  const payload = await duneFetch(env, `/api/v1/query/${queryId}/execute`, {
    method: "POST",
    body: JSON.stringify({ performance: "small" }),
  });
  const executionId = asText(payload.execution_id);
  const state = asText(payload.state);
  if (!executionId || !state) throw new Error("Dune execution omitted execution_id or state.");
  return {
    executionId,
    queryId,
    state,
    submittedAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    executionCostCredits: null,
    error: null,
  };
}

async function fetchDuneUsage(env: DuneAnalyticsEnv): Promise<DuneUsage> {
  const payload = await duneFetch(env, "/api/v1/usage", {
    method: "POST",
    body: JSON.stringify({}),
  });
  const periodsRaw = Array.isArray(payload.billing_periods)
    ? payload.billing_periods
    : Array.isArray(payload.billingPeriods)
      ? payload.billingPeriods
      : [];
  const periods = periodsRaw
    .map(asRecord)
    .filter((period): period is Record<string, unknown> => period !== null)
    .map((period) => ({
      start: asIsoDate(period.start_date),
      end: asIsoDate(period.end_date),
      creditsUsed: asNumber(period.credits_used),
      creditsIncluded: asNumber(period.credits_included),
    }))
    .filter((period) =>
      period.start !== null &&
      period.end !== null &&
      period.creditsUsed !== null &&
      period.creditsUsed >= 0
    )
    .sort((a, b) => (b.start ?? "").localeCompare(a.start ?? ""));
  const now = new Date().toISOString();
  const active = periods.find((period) =>
    (period.start ?? "") <= now && now < (period.end ?? "")
  ) ?? periods[0];
  if (!active?.start || !active.end || active.creditsUsed === null) {
    throw new Error("Dune usage response omitted the current billing period.");
  }
  return {
    billingPeriodStart: active.start,
    billingPeriodEnd: active.end,
    creditsUsed: active.creditsUsed,
    creditsIncluded: active.creditsIncluded,
    fetchedAt: now,
  };
}

async function saveDuneUsage(db: D1Database, usage: DuneUsage): Promise<void> {
  await db.prepare(
    `INSERT INTO analytics_dune_usage_snapshots (
       billing_period_start, billing_period_end, credits_used, credits_included,
       fetched_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(billing_period_start, billing_period_end) DO UPDATE SET
       credits_used = excluded.credits_used,
       credits_included = excluded.credits_included,
       fetched_at = excluded.fetched_at,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(
    usage.billingPeriodStart,
    usage.billingPeriodEnd,
    usage.creditsUsed,
    usage.creditsIncluded,
    usage.fetchedAt,
  ).run();
}

async function loadLatestDuneUsage(db: D1Database): Promise<DuneUsage | null> {
  if (!(await tableExists(db, "analytics_dune_usage_snapshots"))) return null;
  return db.prepare(
    `SELECT
       billing_period_start, billing_period_end, credits_used, credits_included,
       fetched_at
     FROM analytics_dune_usage_snapshots
     ORDER BY fetched_at DESC
     LIMIT 1`
  ).first<{
    billing_period_start: string;
    billing_period_end: string;
    credits_used: number;
    credits_included: number | null;
    fetched_at: string;
  }>().then((row) => row ? {
    billingPeriodStart: row.billing_period_start,
    billingPeriodEnd: row.billing_period_end,
    creditsUsed: row.credits_used,
    creditsIncluded: row.credits_included,
    fetchedAt: row.fetched_at,
  } : null);
}

async function loadActiveExecution(
  db: D1Database,
  sourceKey: string,
): Promise<DuneExecutionRow | null> {
  return db.prepare(
    `SELECT
       execution_id, source_key, query_id, status, range_start, range_end,
       next_offset, rows_ingested, rejected_rows, schema_version,
       execution_cost_credits,
       submitted_at, started_at, completed_at, last_error, updated_at
     FROM analytics_dune_executions
     WHERE source_key = ?
       AND status IN (
         'QUERY_STATE_PENDING',
         'QUERY_STATE_EXECUTING',
         'QUERY_STATE_COMPLETED',
         'INGESTING'
       )
     ORDER BY updated_at DESC
     LIMIT 1`
  ).bind(sourceKey).first<DuneExecutionRow>();
}

async function loadExecution(
  db: D1Database,
  executionId: string,
): Promise<DuneExecutionRow | null> {
  return db.prepare(
    `SELECT
       execution_id, source_key, query_id, status, range_start, range_end,
       next_offset, rows_ingested, rejected_rows, schema_version,
       execution_cost_credits,
       submitted_at, started_at, completed_at, last_error, updated_at
     FROM analytics_dune_executions
     WHERE execution_id = ?
     LIMIT 1`
  ).bind(executionId).first<DuneExecutionRow>();
}

async function upsertExecution(
  db: D1Database,
  input: {
    executionId: string;
    sourceKey: string;
    queryId: number;
    status: string;
    rangeStart?: string | null;
    rangeEnd?: string | null;
    nextOffset?: number;
    rowsIngested?: number;
    rejectedRows?: number;
    schemaVersion?: string | null;
    executionCostCredits?: number | null;
    submittedAt?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    lastError?: string | null;
  },
): Promise<void> {
  await db.prepare(
    `INSERT INTO analytics_dune_executions (
       execution_id, source_key, query_id, status, range_start, range_end,
       next_offset, rows_ingested, rejected_rows, schema_version,
       execution_cost_credits,
       submitted_at, started_at, completed_at, last_error, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(execution_id) DO UPDATE SET
       source_key = excluded.source_key,
       query_id = excluded.query_id,
       status = excluded.status,
       range_start = COALESCE(excluded.range_start, analytics_dune_executions.range_start),
       range_end = COALESCE(excluded.range_end, analytics_dune_executions.range_end),
       next_offset = excluded.next_offset,
       rows_ingested = excluded.rows_ingested,
       rejected_rows = excluded.rejected_rows,
       schema_version = COALESCE(excluded.schema_version, analytics_dune_executions.schema_version),
       execution_cost_credits = COALESCE(
         excluded.execution_cost_credits,
         analytics_dune_executions.execution_cost_credits
       ),
       submitted_at = COALESCE(excluded.submitted_at, analytics_dune_executions.submitted_at),
       started_at = COALESCE(excluded.started_at, analytics_dune_executions.started_at),
       completed_at = COALESCE(excluded.completed_at, analytics_dune_executions.completed_at),
       last_error = excluded.last_error,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(
    input.executionId,
    input.sourceKey,
    input.queryId,
    input.status,
    input.rangeStart ?? ANALYTICS_EPOCH,
    input.rangeEnd ?? null,
    input.nextOffset ?? 0,
    input.rowsIngested ?? 0,
    input.rejectedRows ?? 0,
    input.schemaVersion ?? null,
    input.executionCostCredits ?? null,
    input.submittedAt ?? null,
    input.startedAt ?? null,
    input.completedAt ?? null,
    input.lastError ?? null,
  ).run();
}

async function recordIngestState(
  db: D1Database,
  sourceKey: string,
  input: {
    cursor?: string | null;
    coverageStart?: string | null;
    coverageEnd?: string | null;
    complete: boolean;
    stale: boolean;
    error?: string | null;
    successAt?: string | null;
  },
): Promise<void> {
  const updatedAt = new Date().toISOString();
  await db.prepare(
    `INSERT INTO analytics_ingest_state (
       source_key, cursor, coverage_start, coverage_end, complete, stale,
       last_error, last_success_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_key) DO UPDATE SET
       cursor = excluded.cursor,
       coverage_start = CASE
         WHEN excluded.coverage_start IS NULL THEN analytics_ingest_state.coverage_start
         WHEN analytics_ingest_state.coverage_start IS NULL THEN excluded.coverage_start
         WHEN analytics_ingest_state.coverage_end >= excluded.coverage_start
           THEN MIN(analytics_ingest_state.coverage_start, excluded.coverage_start)
         ELSE excluded.coverage_start
       END,
       coverage_end = CASE
         WHEN excluded.coverage_end IS NULL THEN analytics_ingest_state.coverage_end
         WHEN analytics_ingest_state.coverage_end IS NULL THEN excluded.coverage_end
         WHEN analytics_ingest_state.coverage_end >= excluded.coverage_start
           THEN MAX(analytics_ingest_state.coverage_end, excluded.coverage_end)
         ELSE excluded.coverage_end
       END,
       complete = excluded.complete,
       stale = excluded.stale,
       last_error = excluded.last_error,
       last_success_at = COALESCE(excluded.last_success_at, analytics_ingest_state.last_success_at),
       updated_at = excluded.updated_at`
  ).bind(
    sourceKey,
    input.cursor ?? null,
    input.coverageStart ?? null,
    input.coverageEnd ?? null,
    input.complete ? 1 : 0,
    input.stale ? 1 : 0,
    input.error ?? null,
    input.successAt ?? null,
    updatedAt,
  ).run();
}

function normalizeAddressAllowZero(value: unknown): string | null {
  const wallet = asText(value)?.toLowerCase() ?? "";
  return WALLET_PATTERN.test(wallet) ? wallet : null;
}

function isPositiveIntegerText(value: unknown): boolean {
  const text = asText(value);
  if (!text || !/^\d+$/.test(text)) return false;
  try {
    return BigInt(text) > 0n;
  } catch {
    return false;
  }
}

function requireColumns(page: DuneResultPage, query: DuneQueryDefinition): void {
  const envelope = [
    "row_type",
    "schema_version",
    "coverage_start",
    "coverage_end",
    "chain_id",
    "collection_slug",
    "contract_address",
  ];
  const dataColumns = query.kind === "trades"
    ? [
        "canonical_key",
        "token_id",
        "transaction_hash",
        "event_id",
        "buyer_wallet",
        "seller_wallet",
        "marketplace",
        "price_raw",
        "payment_symbol",
        "sold_at",
      ]
    : [
        "canonical_key",
        "token_id",
        "transaction_hash",
        "event_index",
        "from_wallet",
        "to_wallet",
        "amount",
        "event_id",
        "transferred_at",
      ];
  const available = new Set(page.columnNames);
  const missing = [...envelope, ...dataColumns].filter((column) => !available.has(column));
  if (missing.length > 0) {
    throw new Error(`Dune result schema is missing columns: ${missing.join(", ")}.`);
  }
}

function validateResultPage(
  query: DuneQueryDefinition,
  page: DuneResultPage,
): ValidatedPage {
  if (page.queryId !== query.queryId) {
    throw new Error(`Dune execution belongs to query ${page.queryId ?? "unknown"}, not ${query.queryId}.`);
  }
  requireColumns(page, query);
  if (page.rows.length === 0) {
    throw new Error("Dune result omitted the required coverage row.");
  }

  let coverageStart: string | null = null;
  let coverageEnd: string | null = null;
  const dataRows: Array<Record<string, unknown>> = [];
  for (const row of page.rows) {
    const rowType = asText(row.row_type)?.toLowerCase();
    const rowCoverageStart = asIsoDate(row.coverage_start);
    const rowCoverageEnd = asIsoDate(row.coverage_end);
    const chainId = asInteger(row.chain_id);
    const collectionSlug = asText(row.collection_slug)?.toLowerCase();
    const contract = asText(row.contract_address)?.toLowerCase();
    if (
      (rowType !== "data" && rowType !== "coverage") ||
      asText(row.schema_version) !== query.schemaVersion ||
      chainId !== BASE_CHAIN_ID ||
      collectionSlug !== STATS_COLLECTION_SLUG ||
      contract !== COLLECTION_CONTRACT ||
      !rowCoverageStart ||
      !rowCoverageEnd ||
      rowCoverageStart < ANALYTICS_EPOCH ||
      rowCoverageStart > rowCoverageEnd ||
      Date.parse(rowCoverageEnd) > Date.now() + 5 * 60_000
    ) {
      throw new Error("Dune result failed its schema, collection, or coverage contract.");
    }
    if (
      (coverageStart && coverageStart !== rowCoverageStart) ||
      (coverageEnd && coverageEnd !== rowCoverageEnd)
    ) {
      throw new Error("Dune result contains inconsistent coverage bounds.");
    }
    coverageStart = rowCoverageStart;
    coverageEnd = rowCoverageEnd;
    if (rowType === "data") dataRows.push(row);
  }
  if (!coverageStart || !coverageEnd) {
    throw new Error("Dune result did not provide explicit coverage bounds.");
  }
  return { coverageStart, coverageEnd, dataRows };
}

function parseTradePriceEth(row: Record<string, unknown>): number | null {
  const explicit = asNumber(row.price_eth ?? row.item_price_eth);
  if (explicit !== null && explicit > 0) return explicit;
  const symbol = asText(row.payment_symbol ?? row.currency_symbol)?.toUpperCase();
  const original = asNumber(row.item_amount_original ?? row.amount_original);
  return (symbol === "ETH" || symbol === "WETH") && original !== null && original > 0
    ? original
    : null;
}

function normalizeTradeRows(
  rows: Array<Record<string, unknown>>,
  coverageStart: string,
  coverageEnd: string,
): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const tokenId = asInteger(row.token_id);
    const transactionHash = normalizeHash(row.transaction_hash ?? row.tx_hash);
    const externalId = asText(row.event_id ?? row.unique_trade_id ?? row.external_id);
    const buyerWallet = normalizeWallet(row.buyer_wallet ?? row.buyer);
    const sellerWallet = normalizeWallet(row.seller_wallet ?? row.seller);
    const soldAt = asIsoDate(row.sold_at ?? row.block_time);
    const priceRaw = asText(row.price_raw ?? row.amount_raw);
    const canonicalKey = tokenId && transactionHash
      ? `${BASE_CHAIN_ID}:${transactionHash}:${tokenId}`
      : null;
    if (
      tokenId === null ||
      tokenId < 1 ||
      tokenId > WARPLETS_TOTAL_SUPPLY ||
      !transactionHash ||
      !externalId ||
      !buyerWallet ||
      !sellerWallet ||
      !soldAt ||
      soldAt < coverageStart ||
      soldAt >= coverageEnd ||
      !priceRaw ||
      !isPositiveIntegerText(priceRaw) ||
      asText(row.canonical_key)?.toLowerCase() !== canonicalKey
    ) {
      throw new Error("Dune trade result contains an invalid data row.");
    }
    const paymentSymbol = asText(row.payment_symbol ?? row.currency_symbol)?.toUpperCase() ?? null;
    const priceEth = parseTradePriceEth(row);
    const priceUsd = asNumber(row.price_usd ?? row.item_amount_usd ?? row.amount_usd);
    if ((priceEth !== null && priceEth <= 0) || (priceUsd !== null && priceUsd < 0)) {
      throw new Error("Dune trade result contains an invalid price.");
    }
    return {
      sourceEventKey: externalId,
      canonicalKey,
      tokenId,
      transactionHash,
      externalId,
      buyerWallet,
      sellerWallet,
      marketplace: asText(row.marketplace ?? row.project)?.toLowerCase() ?? "unknown",
      priceRaw,
      paymentDecimals: asInteger(row.payment_decimals),
      paymentSymbol,
      paymentAddress: normalizeAddressAllowZero(row.payment_address ?? row.currency_contract),
      priceEth,
      priceUsd,
      soldAt,
      rawPayload: serialize(row),
    };
  });
}

function normalizeTransferRows(
  rows: Array<Record<string, unknown>>,
  coverageStart: string,
  coverageEnd: string,
): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const tokenId = asInteger(row.token_id);
    const transactionHash = normalizeHash(row.transaction_hash ?? row.tx_hash);
    const eventIndex = asInteger(row.event_index ?? row.evt_index);
    const externalId = asText(row.event_id ?? row.unique_transfer_id ?? row.external_id);
    const transferredAt = asIsoDate(row.transferred_at ?? row.block_time);
    const fromWalletRaw = normalizeAddressAllowZero(row.from_wallet ?? row.from);
    const toWalletRaw = normalizeAddressAllowZero(row.to_wallet ?? row.to);
    const canonicalKey = tokenId && transactionHash && eventIndex !== null
      ? `${BASE_CHAIN_ID}:${transactionHash}:${eventIndex}:${tokenId}`
      : null;
    if (
      tokenId === null ||
      tokenId < 1 ||
      tokenId > WARPLETS_TOTAL_SUPPLY ||
      !transactionHash ||
      eventIndex === null ||
      eventIndex < 0 ||
      !externalId ||
      !transferredAt ||
      transferredAt < coverageStart ||
      transferredAt >= coverageEnd ||
      !fromWalletRaw ||
      !toWalletRaw ||
      asText(row.amount) !== "1" ||
      asText(row.canonical_key)?.toLowerCase() !== canonicalKey
    ) {
      throw new Error("Dune transfer result contains an invalid data row.");
    }
    return {
      sourceEventKey: externalId,
      canonicalKey,
      tokenId,
      transactionHash,
      eventIndex,
      blockNumber: asInteger(row.block_number),
      fromWallet: fromWalletRaw === ZERO_ADDRESS ? null : fromWalletRaw,
      toWallet: toWalletRaw === ZERO_ADDRESS ? null : toWalletRaw,
      executedByWallet: normalizeWallet(row.executed_by),
      transferredAt,
      externalId,
      rawPayload: serialize(row),
    };
  });
}

async function stagePageRows(
  db: D1Database,
  query: DuneQueryDefinition,
  executionId: string,
  rows: Array<Record<string, unknown>>,
  coverageStart: string,
  coverageEnd: string,
): Promise<number> {
  const normalized = query.kind === "trades"
    ? normalizeTradeRows(rows, coverageStart, coverageEnd)
    : normalizeTransferRows(rows, coverageStart, coverageEnd);
  for (let offset = 0; offset < normalized.length; offset += 200) {
    const chunk = normalized.slice(offset, offset + 200);
    await db.prepare(
      `INSERT INTO analytics_dune_result_stage (
         execution_id, source_key, source_event_key, canonical_key,
         payload_json, updated_at
       )
       SELECT
         ?, ?,
         json_extract(value, '$.sourceEventKey'),
         json_extract(value, '$.canonicalKey'),
         value,
         CURRENT_TIMESTAMP
       FROM json_each(?)
       WHERE json_valid(value)
       ON CONFLICT(execution_id, source_event_key) DO UPDATE SET
         canonical_key = excluded.canonical_key,
         payload_json = excluded.payload_json,
         updated_at = CURRENT_TIMESTAMP`
    ).bind(executionId, query.sourceKey, JSON.stringify(chunk)).run();
  }
  return normalized.length;
}

async function promoteTradeStage(db: D1Database, executionId: string): Promise<void> {
  await db.batch([
    db.prepare(
      `INSERT INTO warplet_sales (
         canonical_key, chain_id, collection_slug, token_id,
         transaction_hash, event_id, buyer_wallet, seller_wallet,
         marketplace, price_raw, payment_decimals, payment_symbol,
         payment_address, price_eth, price_usd, sold_at, source,
         raw_payload, created_at, updated_at
       )
       SELECT
         canonical_key,
         8453,
         '10xwarplets',
         CAST(json_extract(payload_json, '$.tokenId') AS INTEGER),
         json_extract(payload_json, '$.transactionHash'),
         json_extract(payload_json, '$.externalId'),
         json_extract(payload_json, '$.buyerWallet'),
         json_extract(payload_json, '$.sellerWallet'),
         json_extract(payload_json, '$.marketplace'),
         json_extract(payload_json, '$.priceRaw'),
         CAST(json_extract(payload_json, '$.paymentDecimals') AS INTEGER),
         json_extract(payload_json, '$.paymentSymbol'),
         json_extract(payload_json, '$.paymentAddress'),
         CAST(json_extract(payload_json, '$.priceEth') AS REAL),
         CAST(json_extract(payload_json, '$.priceUsd') AS REAL),
         json_extract(payload_json, '$.soldAt'),
         'dune:nft.trades',
         json_extract(payload_json, '$.rawPayload'),
         CURRENT_TIMESTAMP,
         CURRENT_TIMESTAMP
       FROM analytics_dune_result_stage
       WHERE execution_id = ? AND source_key = 'dune:trades'
       ON CONFLICT(canonical_key) DO UPDATE SET
         transaction_hash = COALESCE(warplet_sales.transaction_hash, excluded.transaction_hash),
         event_id = COALESCE(warplet_sales.event_id, excluded.event_id),
         buyer_wallet = CASE WHEN warplet_sales.source LIKE 'dune:%'
           THEN excluded.buyer_wallet ELSE COALESCE(warplet_sales.buyer_wallet, excluded.buyer_wallet) END,
         seller_wallet = CASE WHEN warplet_sales.source LIKE 'dune:%'
           THEN excluded.seller_wallet ELSE COALESCE(warplet_sales.seller_wallet, excluded.seller_wallet) END,
         marketplace = CASE WHEN warplet_sales.source LIKE 'dune:%'
           THEN excluded.marketplace ELSE COALESCE(warplet_sales.marketplace, excluded.marketplace) END,
         price_raw = CASE WHEN warplet_sales.source LIKE 'dune:%'
           THEN excluded.price_raw ELSE COALESCE(warplet_sales.price_raw, excluded.price_raw) END,
         payment_decimals = CASE WHEN warplet_sales.source LIKE 'dune:%'
           THEN excluded.payment_decimals ELSE COALESCE(warplet_sales.payment_decimals, excluded.payment_decimals) END,
         payment_symbol = CASE WHEN warplet_sales.source LIKE 'dune:%'
           THEN excluded.payment_symbol ELSE COALESCE(warplet_sales.payment_symbol, excluded.payment_symbol) END,
         payment_address = CASE WHEN warplet_sales.source LIKE 'dune:%'
           THEN excluded.payment_address ELSE COALESCE(warplet_sales.payment_address, excluded.payment_address) END,
         price_eth = CASE WHEN warplet_sales.source LIKE 'dune:%'
           THEN excluded.price_eth ELSE COALESCE(warplet_sales.price_eth, excluded.price_eth) END,
         price_usd = CASE WHEN warplet_sales.source LIKE 'dune:%'
           THEN excluded.price_usd ELSE COALESCE(warplet_sales.price_usd, excluded.price_usd) END,
         sold_at = CASE WHEN warplet_sales.source LIKE 'dune:%'
           THEN excluded.sold_at ELSE warplet_sales.sold_at END,
         source = CASE WHEN warplet_sales.source LIKE 'dune:%'
           THEN excluded.source ELSE warplet_sales.source END,
         raw_payload = CASE WHEN warplet_sales.source LIKE 'dune:%'
           THEN excluded.raw_payload ELSE COALESCE(warplet_sales.raw_payload, excluded.raw_payload) END,
         updated_at = CURRENT_TIMESTAMP`
    ).bind(executionId),
    db.prepare(
      `INSERT INTO warplet_sale_sources (
         canonical_key, source, external_id, observed_at, raw_payload,
         buyer_wallet, seller_wallet, marketplace, price_eth, price_usd,
         payment_symbol, updated_at
       )
       SELECT
         canonical_key,
         'dune:nft.trades',
         json_extract(payload_json, '$.externalId'),
         json_extract(payload_json, '$.soldAt'),
         json_extract(payload_json, '$.rawPayload'),
         json_extract(payload_json, '$.buyerWallet'),
         json_extract(payload_json, '$.sellerWallet'),
         json_extract(payload_json, '$.marketplace'),
         CAST(json_extract(payload_json, '$.priceEth') AS REAL),
         CAST(json_extract(payload_json, '$.priceUsd') AS REAL),
         json_extract(payload_json, '$.paymentSymbol'),
         CURRENT_TIMESTAMP
       FROM analytics_dune_result_stage
       WHERE execution_id = ? AND source_key = 'dune:trades'
       ON CONFLICT(canonical_key, source) DO UPDATE SET
         external_id = excluded.external_id,
         observed_at = excluded.observed_at,
         raw_payload = excluded.raw_payload,
         buyer_wallet = excluded.buyer_wallet,
         seller_wallet = excluded.seller_wallet,
         marketplace = excluded.marketplace,
         price_eth = excluded.price_eth,
         price_usd = excluded.price_usd,
         payment_symbol = excluded.payment_symbol,
         updated_at = CURRENT_TIMESTAMP`
    ).bind(executionId),
  ]);
}

async function promoteTransferStage(db: D1Database, executionId: string): Promise<void> {
  await db.prepare(
    `INSERT INTO warplet_transfers (
       canonical_key, chain_id, collection_slug, token_id,
       transaction_hash, event_index, block_number,
       from_wallet, to_wallet, executed_by_wallet,
       transferred_at, source, external_id, raw_payload, updated_at
     )
     SELECT
       canonical_key,
       8453,
       '10xwarplets',
       CAST(json_extract(payload_json, '$.tokenId') AS INTEGER),
       json_extract(payload_json, '$.transactionHash'),
       CAST(json_extract(payload_json, '$.eventIndex') AS INTEGER),
       CAST(json_extract(payload_json, '$.blockNumber') AS INTEGER),
       json_extract(payload_json, '$.fromWallet'),
       json_extract(payload_json, '$.toWallet'),
       json_extract(payload_json, '$.executedByWallet'),
       json_extract(payload_json, '$.transferredAt'),
       'dune:nft.transfers',
       json_extract(payload_json, '$.externalId'),
       json_extract(payload_json, '$.rawPayload'),
       CURRENT_TIMESTAMP
     FROM analytics_dune_result_stage
     WHERE execution_id = ? AND source_key = 'dune:transfers'
     ON CONFLICT(canonical_key) DO UPDATE SET
       block_number = COALESCE(excluded.block_number, warplet_transfers.block_number),
       from_wallet = excluded.from_wallet,
       to_wallet = excluded.to_wallet,
       executed_by_wallet = COALESCE(
         excluded.executed_by_wallet,
         warplet_transfers.executed_by_wallet
       ),
       transferred_at = excluded.transferred_at,
       external_id = excluded.external_id,
       raw_payload = excluded.raw_payload,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(executionId).run();
}

async function promoteStagedExecution(
  db: D1Database,
  query: DuneQueryDefinition,
  executionId: string,
): Promise<void> {
  if (query.kind === "trades") {
    await promoteTradeStage(db, executionId);
  } else {
    await promoteTransferStage(db, executionId);
  }
  await db.prepare(
    "DELETE FROM analytics_dune_result_stage WHERE execution_id = ?"
  ).bind(executionId).run();
}

export async function rebuildDuneDerivedTables(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM analytics_daily_chain_activity"),
    db.prepare(
      `INSERT INTO analytics_daily_chain_activity (
         day, sales_count, volume_eth, volume_usd, median_sale_eth,
         unique_buyers, unique_sellers, marketplace_count, transfer_count,
         source, updated_at
       )
       WITH dune_sales AS (
         SELECT
           DATE(ss.observed_at) AS day,
           ss.price_eth,
           ss.price_usd,
           ss.buyer_wallet,
           ss.seller_wallet,
           COALESCE(NULLIF(LOWER(TRIM(ss.marketplace)), ''), 'unknown') AS marketplace,
           ROW_NUMBER() OVER (
             PARTITION BY DATE(ss.observed_at)
             ORDER BY (ss.price_eth IS NULL) ASC, ss.price_eth ASC, ss.canonical_key ASC
           ) AS price_rank,
           COUNT(ss.price_eth) OVER (PARTITION BY DATE(ss.observed_at)) AS priced_count
         FROM warplet_sale_sources ss
         WHERE ss.observed_at >= ?
           AND ss.source = 'dune:nft.trades'
       ),
       sales_by_day AS (
         SELECT
           day,
           COUNT(*) AS sales_count,
           COALESCE(SUM(price_eth), 0) AS volume_eth,
           COALESCE(SUM(price_usd), 0) AS volume_usd,
           AVG(CASE
             WHEN price_eth IS NOT NULL
               AND price_rank IN ((priced_count + 1) / 2, (priced_count + 2) / 2)
             THEN price_eth
           END) AS median_sale_eth,
           COUNT(DISTINCT buyer_wallet) AS unique_buyers,
           COUNT(DISTINCT seller_wallet) AS unique_sellers,
           COUNT(DISTINCT marketplace) AS marketplace_count
         FROM dune_sales
         GROUP BY day
       ),
       transfers_by_day AS (
         SELECT DATE(transferred_at) AS day, COUNT(*) AS transfer_count
         FROM warplet_transfers
         WHERE transferred_at >= ?
         GROUP BY DATE(transferred_at)
       ),
       days AS (
         SELECT day FROM sales_by_day
         UNION
         SELECT day FROM transfers_by_day
       )
       SELECT
         days.day,
         COALESCE(s.sales_count, 0),
         COALESCE(s.volume_eth, 0),
         COALESCE(s.volume_usd, 0),
         s.median_sale_eth,
         COALESCE(s.unique_buyers, 0),
         COALESCE(s.unique_sellers, 0),
         COALESCE(s.marketplace_count, 0),
         COALESCE(t.transfer_count, 0),
         'dune',
         CURRENT_TIMESTAMP
       FROM days
       LEFT JOIN sales_by_day s ON s.day = days.day
       LEFT JOIN transfers_by_day t ON t.day = days.day`
    ).bind(ANALYTICS_EPOCH, ANALYTICS_EPOCH),
    db.prepare("DELETE FROM analytics_marketplace_summary"),
    db.prepare(
      `INSERT INTO analytics_marketplace_summary (
         marketplace, sales_count, volume_eth, volume_usd,
         unique_buyers, unique_sellers, coverage_start, coverage_end,
         source, updated_at
       )
       SELECT
         COALESCE(NULLIF(LOWER(TRIM(ss.marketplace)), ''), 'unknown') AS marketplace,
         COUNT(*) AS sales_count,
         COALESCE(SUM(ss.price_eth), 0) AS volume_eth,
         COALESCE(SUM(ss.price_usd), 0) AS volume_usd,
         COUNT(DISTINCT ss.buyer_wallet) AS unique_buyers,
         COUNT(DISTINCT ss.seller_wallet) AS unique_sellers,
         ?,
         MAX(ss.observed_at),
         'dune',
         CURRENT_TIMESTAMP
       FROM warplet_sale_sources ss
       WHERE ss.observed_at >= ?
         AND ss.source = 'dune:nft.trades'
       GROUP BY COALESCE(NULLIF(LOWER(TRIM(ss.marketplace)), ''), 'unknown')`
    ).bind(ANALYTICS_EPOCH, ANALYTICS_EPOCH),
    db.prepare("DELETE FROM holder_activity_summary"),
    db.prepare(
      `INSERT INTO holder_activity_summary (
         wallet, current_owned_count, acquired_since_epoch, disposed_since_epoch,
         first_acquired_at, last_acquired_at, last_disposed_at, last_activity_at,
         oldest_current_holding_at, average_current_holding_days,
         source, updated_at
       )
       WITH wallets AS (
         SELECT LOWER(TRIM(owner_wallet)) AS wallet
         FROM warplet_market_state
         WHERE owner_wallet IS NOT NULL
           AND TRIM(owner_wallet) <> ''
           AND LOWER(TRIM(owner_wallet)) <> ?
         UNION
         SELECT to_wallet FROM warplet_transfers WHERE to_wallet IS NOT NULL
         UNION
         SELECT from_wallet FROM warplet_transfers WHERE from_wallet IS NOT NULL
       ),
       inbound AS (
         SELECT
           to_wallet AS wallet,
           COUNT(*) AS acquired_count,
           MIN(transferred_at) AS first_acquired_at,
           MAX(transferred_at) AS last_acquired_at
         FROM warplet_transfers
         WHERE to_wallet IS NOT NULL
         GROUP BY to_wallet
       ),
       outbound AS (
         SELECT
           from_wallet AS wallet,
           COUNT(*) AS disposed_count,
           MAX(transferred_at) AS last_disposed_at
         FROM warplet_transfers
         WHERE from_wallet IS NOT NULL
         GROUP BY from_wallet
       ),
       current_tokens AS (
         SELECT
           LOWER(TRIM(m.owner_wallet)) AS wallet,
           m.token_id,
           COALESCE(
             (
               SELECT MAX(t.transferred_at)
               FROM warplet_transfers t
               WHERE t.token_id = m.token_id
                 AND t.to_wallet = LOWER(TRIM(m.owner_wallet))
             ),
             ?
           ) AS acquired_at
         FROM warplet_market_state m
         WHERE m.owner_wallet IS NOT NULL
           AND TRIM(m.owner_wallet) <> ''
           AND LOWER(TRIM(m.owner_wallet)) <> ?
       ),
       current_summary AS (
         SELECT
           wallet,
           COUNT(*) AS current_owned_count,
           MIN(acquired_at) AS oldest_current_holding_at,
           AVG(MAX(0, JULIANDAY('now') - JULIANDAY(acquired_at))) AS average_current_holding_days
         FROM current_tokens
         GROUP BY wallet
       )
       SELECT
         w.wallet,
         COALESCE(c.current_owned_count, 0),
         COALESCE(i.acquired_count, 0),
         COALESCE(o.disposed_count, 0),
         i.first_acquired_at,
         i.last_acquired_at,
         o.last_disposed_at,
         CASE
           WHEN i.last_acquired_at IS NULL THEN o.last_disposed_at
           WHEN o.last_disposed_at IS NULL THEN i.last_acquired_at
           WHEN i.last_acquired_at >= o.last_disposed_at THEN i.last_acquired_at
           ELSE o.last_disposed_at
         END,
         c.oldest_current_holding_at,
         c.average_current_holding_days,
         'dune:nft.transfers',
         CURRENT_TIMESTAMP
       FROM wallets w
       LEFT JOIN inbound i ON i.wallet = w.wallet
       LEFT JOIN outbound o ON o.wallet = w.wallet
       LEFT JOIN current_summary c ON c.wallet = w.wallet`
    ).bind(ZERO_ADDRESS, ANALYTICS_EPOCH, ZERO_ADDRESS),
  ]);
}

async function ingestPageRows(
  db: D1Database,
  query: DuneQueryDefinition,
  executionId: string,
  page: DuneResultPage,
): Promise<{ rowsIngested: number; coverageStart: string; coverageEnd: string }> {
  const validated = validateResultPage(query, page);
  const rowsIngested = await stagePageRows(
    db,
    query,
    executionId,
    validated.dataRows,
    validated.coverageStart,
    validated.coverageEnd,
  );
  return {
    rowsIngested,
    coverageStart: validated.coverageStart,
    coverageEnd: validated.coverageEnd,
  };
}

async function finalizeExecution(
  db: D1Database,
  query: DuneQueryDefinition,
  execution: DuneExecutionRow,
  coverageStart: string,
  coverageEnd: string,
  executionCostCredits: number | null,
): Promise<void> {
  const completedAt = new Date().toISOString();
  await promoteStagedExecution(db, query, execution.execution_id);
  await rebuildDuneDerivedTables(db);
  await upsertExecution(db, {
    executionId: execution.execution_id,
    sourceKey: query.sourceKey,
    queryId: query.queryId,
    status: "COMPLETED",
    rangeStart: coverageStart,
    rangeEnd: coverageEnd,
    nextOffset: execution.next_offset,
    rowsIngested: execution.rows_ingested,
    rejectedRows: 0,
    schemaVersion: query.schemaVersion,
    executionCostCredits,
    submittedAt: execution.submitted_at,
    startedAt: execution.started_at,
    completedAt,
  });
  await recordIngestState(db, query.sourceKey, {
    cursor: execution.execution_id,
    coverageStart,
    coverageEnd,
    complete: true,
    stale: false,
    successAt: completedAt,
  });
}

async function ingestExecutionPages(
  env: DuneAnalyticsEnv,
  query: DuneQueryDefinition,
  execution: DuneExecutionRow,
  firstPage?: DuneResultPage,
): Promise<{
  status: "complete" | "ingesting";
  rowsIngested: number;
  coverageEnd: string | null;
}> {
  const pageSize = parsePositiveInteger(
    env.DUNE_RESULTS_PAGE_SIZE,
    DEFAULT_PAGE_SIZE,
    1,
    1_000,
  );
  const maxPages = parsePositiveInteger(
    env.DUNE_MAX_RESULT_PAGES,
    DEFAULT_MAX_PAGES,
    1,
    20,
  );
  let offset = execution.next_offset;
  let totalRows = execution.rows_ingested;
  let coverageStart = execution.range_start === ANALYTICS_EPOCH && execution.rows_ingested === 0
    ? null
    : execution.range_start;
  let coverageEnd = execution.range_end;
  let page = firstPage;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const currentPage = page ?? await fetchExecutionResults(
      env,
      execution.execution_id,
      pageSize,
      offset,
    );
    page = undefined;
    const pageState = currentPage.state?.toUpperCase() ?? "QUERY_STATE_COMPLETED";
    if (pageState === "QUERY_STATE_COMPLETED_PARTIAL") {
      throw new Error("Dune returned partial results; preserving the last complete D1 dataset.");
    }
    if (pageState !== "QUERY_STATE_COMPLETED") {
      throw new Error(`Dune results are not complete (${pageState}).`);
    }
    const ingested = await ingestPageRows(
      env.WARPLETS,
      query,
      execution.execution_id,
      currentPage,
    );
    totalRows += ingested.rowsIngested;
    if (
      (coverageStart && coverageStart !== ingested.coverageStart) ||
      (coverageEnd && coverageEnd !== ingested.coverageEnd)
    ) {
      throw new Error("Dune result pages contain inconsistent coverage bounds.");
    }
    coverageStart = ingested.coverageStart;
    coverageEnd = ingested.coverageEnd;
    const nextOffset = currentPage.nextOffset;
    offset = nextOffset ?? offset + currentPage.rows.length;
    await upsertExecution(env.WARPLETS, {
      executionId: execution.execution_id,
      sourceKey: query.sourceKey,
      queryId: query.queryId,
      status: nextOffset === null ? "QUERY_STATE_COMPLETED" : "INGESTING",
      rangeStart: coverageStart,
      rangeEnd: coverageEnd,
      nextOffset: offset,
      rowsIngested: totalRows,
      rejectedRows: 0,
      schemaVersion: query.schemaVersion,
      executionCostCredits:
        currentPage.executionCostCredits ?? execution.execution_cost_credits,
      submittedAt: currentPage.submittedAt ?? execution.submitted_at,
      startedAt: currentPage.startedAt ?? execution.started_at,
      completedAt: currentPage.completedAt ?? execution.completed_at,
    });
    if (nextOffset === null) {
      const latest = await loadExecution(env.WARPLETS, execution.execution_id);
      if (!latest) throw new Error("Dune execution state disappeared before finalization.");
      if (!coverageStart || !coverageEnd) {
        throw new Error("Dune execution completed without explicit coverage bounds.");
      }
      if (
        currentPage.totalRowCount === null ||
        totalRows !== Math.max(0, currentPage.totalRowCount - 1)
      ) {
        throw new Error("Dune execution row count does not match its declared result metadata.");
      }
      const staged = await env.WARPLETS.prepare(
        `SELECT COUNT(*) AS staged_rows
         FROM analytics_dune_result_stage
         WHERE execution_id = ? AND source_key = ?`
      ).bind(execution.execution_id, query.sourceKey).first<{ staged_rows: number }>();
      if ((staged?.staged_rows ?? 0) !== totalRows) {
        throw new Error("Dune staging rejected or duplicated one or more result rows.");
      }
      await finalizeExecution(
        env.WARPLETS,
        query,
        latest,
        coverageStart,
        coverageEnd,
        currentPage.executionCostCredits ?? execution.execution_cost_credits,
      );
      return { status: "complete", rowsIngested: totalRows, coverageEnd };
    }
  }

  return { status: "ingesting", rowsIngested: totalRows, coverageEnd };
}

async function failExecution(
  db: D1Database,
  query: DuneQueryDefinition,
  executionId: string | null,
  error: unknown,
): Promise<string> {
  const message = sanitizeError(error);
  if (executionId) {
    const current = await loadExecution(db, executionId);
    const rejectedRows = /schema|coverage|invalid|row count|staging|query/i.test(message)
      ? (current?.rejected_rows ?? 0) + 1
      : current?.rejected_rows ?? 0;
    await upsertExecution(db, {
      executionId,
      sourceKey: query.sourceKey,
      queryId: query.queryId,
      status: "FAILED",
      rangeStart: current?.range_start ?? null,
      rangeEnd: current?.range_end ?? null,
      nextOffset: current?.next_offset ?? 0,
      rowsIngested: current?.rows_ingested ?? 0,
      rejectedRows,
      schemaVersion: current?.schema_version ?? query.schemaVersion,
      executionCostCredits: current?.execution_cost_credits ?? null,
      submittedAt: current?.submitted_at ?? null,
      startedAt: current?.started_at ?? null,
      completedAt: new Date().toISOString(),
      lastError: message,
    });
    await db.prepare(
      "DELETE FROM analytics_dune_result_stage WHERE execution_id = ?"
    ).bind(executionId).run().catch(() => undefined);
  }
  await recordIngestState(db, query.sourceKey, {
    cursor: executionId,
    complete: false,
    stale: true,
    error: message,
  });
  return message;
}

async function hasOversizedExecution(
  db: D1Database,
  maxCredits: number,
  billingPeriodStart: string,
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT 1 AS found
     FROM analytics_dune_executions
     WHERE submitted_at >= ?
       AND execution_cost_credits > ?
     ORDER BY submitted_at DESC
     LIMIT 1`
  ).bind(billingPeriodStart, maxCredits).first<{ found: number }>();
  return row?.found === 1;
}

async function queryIsDue(
  db: D1Database,
  query: DuneQueryDefinition,
  intervalHours: number,
): Promise<boolean> {
  const [state, attempt] = await Promise.all([
    db.prepare(
      `SELECT last_success_at
       FROM analytics_ingest_state
       WHERE source_key = ?
       LIMIT 1`
    ).bind(query.sourceKey).first<{ last_success_at: string | null }>(),
    db.prepare(
      `SELECT status, updated_at
       FROM analytics_dune_executions
       WHERE source_key = ?
       ORDER BY updated_at DESC
       LIMIT 1`
    ).bind(query.sourceKey).first<{ status: string; updated_at: string }>(),
  ]);
  if (
    attempt?.status === "FAILED" &&
    Number.isFinite(Date.parse(attempt.updated_at)) &&
    Date.now() - Date.parse(attempt.updated_at) < FAILURE_RETRY_HOURS * 3_600_000
  ) {
    return false;
  }
  if (!state?.last_success_at) return true;
  const lastSuccess = Date.parse(state.last_success_at);
  return !Number.isFinite(lastSuccess) ||
    Date.now() - lastSuccess >= intervalHours * 3_600_000;
}

async function acquireQueryLease(
  db: D1Database,
  sourceKey: string,
): Promise<string | null> {
  if (!(await tableExists(db, "analytics_dune_leases"))) return null;
  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  const leaseUntil = new Date(Date.now() + LEASE_MINUTES * 60_000).toISOString();
  const row = await db.prepare(
    `INSERT INTO analytics_dune_leases (
       source_key, lease_token, lease_until, updated_at
     ) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(source_key) DO UPDATE SET
       lease_token = excluded.lease_token,
       lease_until = excluded.lease_until,
       updated_at = CURRENT_TIMESTAMP
     WHERE analytics_dune_leases.lease_until <= ?
     RETURNING lease_token`
  ).bind(sourceKey, token, leaseUntil, now).first<{ lease_token: string }>();
  return row?.lease_token === token ? token : null;
}

async function releaseQueryLease(
  db: D1Database,
  sourceKey: string,
  token: string,
): Promise<void> {
  await db.prepare(
    "DELETE FROM analytics_dune_leases WHERE source_key = ? AND lease_token = ?"
  ).bind(sourceKey, token).run();
}

async function advanceQuery(
  env: DuneAnalyticsEnv,
  query: DuneQueryDefinition,
  options: DuneAdvanceOptions,
  allowExecution: boolean,
  allowResultExport: boolean,
): Promise<DuneAdvanceResult["queries"][number]> {
  let active = options.executionId
    ? await loadExecution(env.WARPLETS, options.executionId)
    : await loadActiveExecution(env.WARPLETS, query.sourceKey);

  try {
    if (active && active.query_id !== query.queryId) {
      throw new Error("Stored Dune execution does not belong to the configured query.");
    }
    if (active?.status === "COMPLETED") {
      return {
        kind: query.kind,
        queryId: query.queryId,
        status: "complete",
        executionId: active.execution_id,
        rowsIngested: active.rows_ingested,
        coverageEnd: active.range_end,
      };
    }
    if (options.executionId && !active) {
      const status = await fetchExecutionStatus(env, options.executionId);
      if (status.queryId !== query.queryId) {
        throw new Error("Dune execution does not belong to the configured query.");
      }
      await upsertExecution(env.WARPLETS, {
        executionId: status.executionId,
        sourceKey: query.sourceKey,
        queryId: query.queryId,
        status: status.state,
        executionCostCredits: status.executionCostCredits,
        submittedAt: status.submittedAt,
        startedAt: status.startedAt,
        completedAt: status.completedAt,
        lastError: status.error,
      });
      active = await loadExecution(env.WARPLETS, status.executionId);
    }

    if (active?.status === "INGESTING" || active?.status === "QUERY_STATE_COMPLETED") {
      if (!allowResultExport) {
        return {
          kind: query.kind,
          queryId: query.queryId,
          status: "usage_unavailable",
          executionId: active.execution_id,
        };
      }
      const ingested = await ingestExecutionPages(env, query, active);
      return {
        kind: query.kind,
        queryId: query.queryId,
        status: ingested.status,
        executionId: active.execution_id,
        rowsIngested: ingested.rowsIngested,
        coverageEnd: ingested.coverageEnd,
      };
    }

    if (active) {
      const status = await fetchExecutionStatus(env, active.execution_id);
      if (status.queryId !== query.queryId) {
        throw new Error("Dune execution does not belong to the configured query.");
      }
      await upsertExecution(env.WARPLETS, {
        executionId: status.executionId,
        sourceKey: query.sourceKey,
        queryId: query.queryId,
        status: status.state,
        rangeEnd: active.range_end,
        nextOffset: active.next_offset,
        rowsIngested: active.rows_ingested,
        executionCostCredits: status.executionCostCredits,
        submittedAt: status.submittedAt ?? active.submitted_at,
        startedAt: status.startedAt ?? active.started_at,
        completedAt: status.completedAt ?? active.completed_at,
        lastError: status.error,
      });
      const normalizedState = status.state.toUpperCase();
      if (normalizedState === "QUERY_STATE_COMPLETED") {
        if (!allowResultExport) {
          return {
            kind: query.kind,
            queryId: query.queryId,
            status: "usage_unavailable",
            executionId: status.executionId,
          };
        }
        const refreshed = await loadExecution(env.WARPLETS, status.executionId);
        if (!refreshed) throw new Error("Dune execution state could not be resumed.");
        const ingested = await ingestExecutionPages(env, query, refreshed);
        return {
          kind: query.kind,
          queryId: query.queryId,
          status: ingested.status,
          executionId: status.executionId,
          rowsIngested: ingested.rowsIngested,
          coverageEnd: ingested.coverageEnd,
        };
      }
      if (
        normalizedState === "QUERY_STATE_PENDING" ||
        normalizedState === "QUERY_STATE_EXECUTING"
      ) {
        return {
          kind: query.kind,
          queryId: query.queryId,
          status: "pending",
          executionId: status.executionId,
        };
      }
      throw new Error(
        status.error ?? `Dune execution ended in ${normalizedState}.`,
      );
    }

    if (allowExecution) {
      const started = await startQueryExecution(env, query.queryId);
      await upsertExecution(env.WARPLETS, {
        executionId: started.executionId,
        sourceKey: query.sourceKey,
        queryId: query.queryId,
        status: started.state,
        submittedAt: started.submittedAt,
      });
      return {
        kind: query.kind,
        queryId: query.queryId,
        status: "pending",
        executionId: started.executionId,
      };
    }

    if (!allowResultExport) {
      return {
        kind: query.kind,
        queryId: query.queryId,
        status: "usage_unavailable",
      };
    }
    const page = await fetchLatestQueryResults(
      env,
      query.queryId,
      1,
    );
    if (page.queryId !== query.queryId) {
      throw new Error("Dune latest result does not belong to the configured query.");
    }
    const executionId = page.executionId;
    if (!executionId) throw new Error("Dune latest results omitted execution_id.");
    const existing = await loadExecution(env.WARPLETS, executionId);
    if (existing?.status === "COMPLETED") {
      return {
        kind: query.kind,
        queryId: query.queryId,
        status: "complete",
        executionId,
        rowsIngested: existing.rows_ingested,
        coverageEnd: existing.range_end,
      };
    }
    await upsertExecution(env.WARPLETS, {
      executionId,
      sourceKey: query.sourceKey,
      queryId: query.queryId,
      status: "INGESTING",
      executionCostCredits: page.executionCostCredits,
      submittedAt: page.submittedAt,
      startedAt: page.startedAt,
      completedAt: page.completedAt,
    });
    const created = await loadExecution(env.WARPLETS, executionId);
    if (!created) throw new Error("Dune result state could not be persisted.");
    const ingested = await ingestExecutionPages(env, query, created, page);
    return {
      kind: query.kind,
      queryId: query.queryId,
      status: ingested.status,
      executionId,
      rowsIngested: ingested.rowsIngested,
      coverageEnd: ingested.coverageEnd,
    };
  } catch (error) {
    const errorMessage = await failExecution(
      env.WARPLETS,
      query,
      active?.execution_id ?? options.executionId ?? null,
      error,
    );
    return {
      kind: query.kind,
      queryId: query.queryId,
      status: "failed",
      executionId: active?.execution_id ?? options.executionId ?? null,
      error: errorMessage,
    };
  }
}

export async function advanceDuneAnalytics(
  env: DuneAnalyticsEnv,
  options: DuneAdvanceOptions = {},
): Promise<DuneAdvanceResult> {
  const monthlyCreditBudget = parsePositiveNumber(
    env.DUNE_MONTHLY_CREDIT_BUDGET,
    DEFAULT_MONTHLY_CREDIT_BUDGET,
    0,
    2_500,
  );
  const maxCreditsPerExecution = parsePositiveNumber(
    env.DUNE_MAX_CREDITS_PER_EXECUTION,
    DEFAULT_MAX_CREDITS_PER_EXECUTION,
    1,
    100,
  );
  const base: Omit<DuneAdvanceResult, "status" | "queries" | "creditsThisMonth"> = {
    enabled: enabled(env.DUNE_ENABLED),
    configured: false,
    usageAvailable: false,
    billingPeriodStart: null,
    billingPeriodEnd: null,
    monthlyCreditBudget,
    maxCreditsPerExecution,
  };
  if (!base.enabled) {
    return { ...base, status: "disabled", configured: false, queries: [], creditsThisMonth: 0 };
  }
  const queries = configuredQueries(env, options.backfill === true);
  const configured = Boolean(env.DUNE_API_KEY?.trim()) && queries.length > 0;
  if (!configured) {
    return { ...base, configured: false, status: "unconfigured", queries: [], creditsThisMonth: 0 };
  }
  const requiredTables = await Promise.all([
    "analytics_dune_executions",
    "analytics_dune_result_stage",
    "analytics_dune_leases",
    "analytics_dune_usage_snapshots",
  ].map((table) => tableExists(env.WARPLETS, table)));
  if (requiredTables.some((exists) => !exists)) {
    return {
      ...base,
      configured: true,
      status: "unconfigured",
      queries: queries.map((query) => ({
        kind: query.kind,
        queryId: query.queryId,
        status: "migration_required",
      })),
      creditsThisMonth: 0,
    };
  }

  let usage: DuneUsage | null = null;
  let usageAvailable = false;
  try {
    usage = await fetchDuneUsage(env);
    await saveDuneUsage(env.WARPLETS, usage);
    usageAvailable = true;
  } catch {
    // A cached snapshot remains useful for observability, but never authorizes
    // another charged execution or result export.
    usage = await loadLatestDuneUsage(env.WARPLETS);
  }
  let creditsThisMonth = usage?.creditsUsed ?? 0;
  let oversizedExecution = usage
    ? await hasOversizedExecution(
        env.WARPLETS,
        maxCreditsPerExecution,
        usage.billingPeriodStart,
      )
    : false;
  let budgetPaused =
    Boolean(usage && creditsThisMonth >= monthlyCreditBudget) ||
    oversizedExecution;
  const executeRequested =
    enabled(env.DUNE_EXECUTE_ENABLED) &&
    options.execute !== false &&
    usageAvailable &&
    !budgetPaused;
  const allowResultExport = usageAvailable && !budgetPaused;
  const intervalHours = parsePositiveNumber(
    env.DUNE_EXECUTION_INTERVAL_HOURS,
    DEFAULT_INTERVAL_HOURS,
    1,
    168,
  );
  const selectedQueries = options.queryId
    ? queries.filter((query) => query.queryId === options.queryId)
    : queries;
  const results: DuneAdvanceResult["queries"] = [];
  const anyActive = await env.WARPLETS.prepare(
    `SELECT 1 AS found
     FROM analytics_dune_executions
     WHERE status IN (
       'QUERY_STATE_PENDING',
       'QUERY_STATE_EXECUTING',
       'QUERY_STATE_COMPLETED',
       'INGESTING'
     )
     LIMIT 1`
  ).first<{ found: number }>();
  let mayStartExecution = executeRequested && anyActive?.found !== 1;

  for (const query of selectedQueries) {
    const active = await loadActiveExecution(env.WARPLETS, query.sourceKey);
    const due = options.force || Boolean(active) ||
      await queryIsDue(env.WARPLETS, query, intervalHours);
    if (!due) {
      results.push({ kind: query.kind, queryId: query.queryId, status: "idle" });
      continue;
    }
    if (executeRequested && !active && !mayStartExecution) {
      results.push({ kind: query.kind, queryId: query.queryId, status: "idle" });
      continue;
    }
    const leaseToken = await acquireQueryLease(env.WARPLETS, query.sourceKey);
    if (!leaseToken) {
      results.push({ kind: query.kind, queryId: query.queryId, status: "locked" });
      continue;
    }
    try {
      const result = await advanceQuery(
        env,
        query,
        options,
        mayStartExecution,
        allowResultExport,
      );
      results.push(result);
      if (mayStartExecution && !active && result.status === "pending") {
        // The free-plan path deliberately starts at most one new query per cron
        // invocation. Existing executions can still be polled or ingested.
        mayStartExecution = false;
      }
    } finally {
      await releaseQueryLease(env.WARPLETS, query.sourceKey, leaseToken)
        .catch(() => undefined);
    }
  }

  if (usageAvailable) {
    try {
      usage = await fetchDuneUsage(env);
      await saveDuneUsage(env.WARPLETS, usage);
      creditsThisMonth = usage.creditsUsed;
      oversizedExecution = await hasOversizedExecution(
        env.WARPLETS,
        maxCreditsPerExecution,
        usage.billingPeriodStart,
      );
      budgetPaused =
        creditsThisMonth >= monthlyCreditBudget ||
        oversizedExecution;
    } catch {
      // The preflight authorized this run, but expose the failed post-export
      // reconciliation and fail closed on the next invocation.
      usageAvailable = false;
    }
  }
  const statuses = new Set(results.map((result) => result.status));
  const status: DuneAdvanceResult["status"] = budgetPaused
    ? "budget_paused"
    : !usageAvailable || statuses.has("failed") || statuses.has("usage_unavailable")
      ? "partial"
      : statuses.has("ingesting")
        ? "ingesting"
        : statuses.has("pending")
          ? "pending"
          : statuses.has("complete")
            ? "complete"
            : "idle";
  return {
    ...base,
    configured: true,
    usageAvailable,
    billingPeriodStart: usage?.billingPeriodStart ?? null,
    billingPeriodEnd: usage?.billingPeriodEnd ?? null,
    status,
    queries: results,
    creditsThisMonth,
  };
}

export function isDuneWebhookAuthorized(
  env: DuneAnalyticsEnv,
  request: Request,
): boolean {
  const expected = env.DUNE_WEBHOOK_SECRET?.trim();
  if (!expected) return false;
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const supplied = (
    request.headers.get("x-dune-webhook-secret")?.trim() ||
    (authorization.toLowerCase().startsWith("bearer ")
      ? authorization.slice(7).trim()
      : "") ||
    new URL(request.url).searchParams.get("token")?.trim() ||
    ""
  );
  if (supplied.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function resolveDuneWebhook(
  env: DuneAnalyticsEnv,
  request: Request,
): Promise<DuneAdvanceResult> {
  const payload = asRecord(await request.json().catch(() => null));
  const queryResult = asRecord(payload?.query_result);
  const queryId = asInteger(queryResult?.query_id ?? payload?.query_id);
  const executionId = asText(queryResult?.execution_id ?? payload?.execution_id);
  if (!queryId || !executionId) throw new Error("Dune webhook omitted query_id or execution_id.");
  const configured = [
    ...configuredQueries(env, false),
    ...configuredQueries(env, true),
  ];
  const matching = configured.find((query) => query.queryId === queryId);
  if (!matching) {
    throw new Error("Dune webhook referenced an unconfigured query.");
  }
  return advanceDuneAnalytics(env, {
    force: true,
    execute: false,
    queryId,
    executionId,
    backfill: configuredQueries(env, true).some((query) => query.queryId === queryId),
  });
}

export const DUNE_COLLECTION_CONTRACT = COLLECTION_CONTRACT;

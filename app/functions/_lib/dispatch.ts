/**
 * Notification dispatch service.
 *
 * Sends a single notification to one FID, logs the attempt to D1,
 * and returns a typed result indicating success or the failure reason.
 *
 * Constraints enforced per Farcaster spec:
 *   - title <= 32 chars
 *   - body <= 128 chars
 *   - notificationId <= 128 chars
 *   - tokens array <= 100 per request (we send one at a time here)
 *   - targetUrl must be a valid https URL
 */

import { sendNotificationResponseSchema } from "@farcaster/miniapp-sdk";

export type DispatchResult =
  | { state: "success" }
  | { state: "no_token" }
  | { state: "rate_limited" }
  | { state: "invalid_token" }
  | { state: "failed"; error: unknown }
  | { state: "validation_error"; message: string };

export interface DispatchOptions {
  fid: number;
  appSlug: string;
  notificationUrl: string;
  notificationToken: string;
  notificationId: string;
  title: string;
  body: string;
  targetUrl: string;
}

interface NotificationBuckets {
  successfulTokens: string[];
  invalidTokens: string[];
  rateLimitedTokens: string[];
  failedTokens: FailedToken[];
}

interface FailedToken {
  token: string;
  reason?: string;
  fid?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readTokenArray(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  return value.every((item) => typeof item === "string") ? value : null;
}

function readFailedTokens(value: unknown): FailedToken[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;

  const failedTokens: FailedToken[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      failedTokens.push({ token: item });
      continue;
    }

    if (!isRecord(item) || typeof item.token !== "string") {
      return null;
    }

    failedTokens.push({
      token: item.token,
      reason: typeof item.reason === "string" ? item.reason : undefined,
      fid: typeof item.fid === "number" ? item.fid : undefined,
    });
  }

  return failedTokens;
}

function readNotificationBuckets(responseJson: unknown): NotificationBuckets | null {
  const source = isRecord(responseJson) && isRecord(responseJson.result)
    ? responseJson.result
    : isRecord(responseJson)
    ? responseJson
    : null;

  if (!source) return null;

  const successfulTokens = readTokenArray(source.successfulTokens);
  const invalidTokens = readTokenArray(source.invalidTokens);
  const rateLimitedTokens = readTokenArray(source.rateLimitedTokens);
  const failedTokens = readFailedTokens(source.failedTokens);

  if (!successfulTokens || !invalidTokens || !rateLimitedTokens || !failedTokens) {
    return null;
  }

  return {
    successfulTokens,
    invalidTokens,
    rateLimitedTokens,
    failedTokens,
  };
}

function summarizeBuckets(buckets: NotificationBuckets): string {
  const failedReasons = buckets.failedTokens.reduce<Record<string, number>>((acc, item) => {
    const reason = item.reason ?? "unknown";
    acc[reason] = (acc[reason] ?? 0) + 1;
    return acc;
  }, {});

  return JSON.stringify({
    successfulTokens: buckets.successfulTokens.length,
    invalidTokens: buckets.invalidTokens.length,
    rateLimitedTokens: buckets.rateLimitedTokens.length,
    failedTokens: buckets.failedTokens.length,
    failedReasons,
  });
}

/**
 * Validates payload constraints and sends one notification.
 * Logs the attempt to D1 and returns a typed result.
 */
export async function dispatchNotification(
  db: D1Database,
  opts: DispatchOptions
): Promise<DispatchResult> {
  const { fid, appSlug, notificationUrl, notificationToken, notificationId, title, body, targetUrl } = opts;

  // Validate constraints
  if (notificationId.length > 128)
    return { state: "validation_error", message: "notificationId exceeds 128 chars" };
  if (title.length > 32)
    return { state: "validation_error", message: "title exceeds 32 chars" };
  if (body.length > 128)
    return { state: "validation_error", message: "body exceeds 128 chars" };
  if (!targetUrl.startsWith("https://"))
    return { state: "validation_error", message: "targetUrl must be https" };

  // Upsert dispatch record (idempotency: ignore if already delivered)
  const dispatch = await db
    .prepare(
      `INSERT INTO notification_dispatches (fid, app_slug, notification_id, title, body, target_url, status, attempt_count)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 0)
       ON CONFLICT(fid, notification_id) DO UPDATE SET
         attempt_count = attempt_count + 1,
         updated_at = datetime('now')
       RETURNING id, status, attempt_count`
    )
    .bind(fid, appSlug, notificationId, title.slice(0, 32), body.slice(0, 128), targetUrl)
    .first<{ id: number; status: string; attempt_count: number }>();

  if (!dispatch) {
    return { state: "failed", error: "Failed to create dispatch record" };
  }

  // Don't re-send if already successfully delivered
  if (dispatch.status === "delivered" && dispatch.attempt_count === 0) {
    return { state: "success" };
  }

  let result: DispatchResult = { state: "failed", error: "Unknown error" };
  let responseStatus: number | null = null;
  let attemptResult = "error";
  let errorMessage: string | null = null;

  try {
    const response = await fetch(notificationUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        notificationId,
        title: title.slice(0, 32),
        body: body.slice(0, 128),
        targetUrl,
        tokens: [notificationToken],
      }),
    });

    responseStatus = response.status;
    const responseJson = await response.json();

    if (response.status === 200) {
      const parsed = sendNotificationResponseSchema.safeParse(responseJson);
      const buckets = readNotificationBuckets(responseJson);

      if (!parsed.success && !buckets) {
        result = { state: "failed", error: parsed.error.issues };
        attemptResult = "error";
        errorMessage = JSON.stringify(parsed.error.issues);
      } else {
        const data = buckets ?? {
          ...parsed.data!.result,
          failedTokens: [],
        };

        if (data.invalidTokens.includes(notificationToken)) {
          result = { state: "invalid_token" };
          attemptResult = "invalid";
        } else if (data.rateLimitedTokens.includes(notificationToken)) {
          result = { state: "rate_limited" };
          attemptResult = "rate_limited";
        } else if (data.successfulTokens.includes(notificationToken)) {
          result = { state: "success" };
          attemptResult = "success";
        } else if (data.failedTokens.some((item) => item.token === notificationToken)) {
          const bucketSummary = summarizeBuckets(data);
          result = { state: "failed", error: `failed_token:${bucketSummary}` };
          attemptResult = "error";
          errorMessage = `failed_token:${bucketSummary}`;
        } else {
          // Token appeared in unknown bucket
          const bucketSummary = summarizeBuckets(data);
          result = { state: "failed", error: `unknown_bucket:${bucketSummary}` };
          attemptResult = "error";
          errorMessage = `unknown_bucket:${bucketSummary}`;
        }
      }
    } else {
      result = { state: "failed", error: `HTTP ${response.status}: ${JSON.stringify(responseJson)}` };
      attemptResult = "error";
      errorMessage = `HTTP ${response.status}`;
    }
  } catch (err) {
    result = { state: "failed", error: err };
    attemptResult = "error";
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  // Map result to dispatch status
  const dispatchStatus =
    result.state === "success"
      ? "delivered"
      : result.state === "rate_limited"
      ? "rate_limited"
      : result.state === "invalid_token"
      ? "invalid"
      : "failed";

  // Log attempt and update dispatch status in parallel
  await Promise.all([
    db
      .prepare(
        `INSERT INTO notification_attempts (dispatch_id, fid, notification_url, response_status, result, error_message)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(dispatch.id, fid, notificationUrl, responseStatus, attemptResult, errorMessage)
      .run(),
    db
      .prepare(
        `UPDATE notification_dispatches
         SET status = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .bind(dispatchStatus, dispatch.id)
      .run(),
  ]);

  // If token is invalid, disable only this app-scoped token row.
  if (result.state === "invalid_token") {
    await db
      .prepare(
        `UPDATE miniapp_notification_tokens
         SET enabled = 0, updated_at = datetime('now')
         WHERE fid = ? AND app_slug = ?`
      )
      .bind(fid, appSlug)
      .run();
  }

  return result;
}

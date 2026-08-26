import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchNotification } from "./dispatch";

afterEach(() => vi.unstubAllGlobals());

function retryDb(existingStatus: string): { db: D1Database; statements: string[] } {
  const statements: string[] = [];
  const db = {
    prepare(sql: string) {
      statements.push(sql);
      return {
        bind() {
          return {
            async first() {
              if (sql.includes("SELECT id, status, attempt_count")) {
                return { id: 7, status: existingStatus, attempt_count: 1, updated_at: "2026-08-26T00:00:00.000Z" };
              }
              if (sql.includes("UPDATE notification_dispatches") && sql.includes("RETURNING")) {
                return { id: 7, status: "pending", attempt_count: 1 };
              }
              return null;
            },
            async run() { return {}; },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, statements };
}

const options = {
  fid: 1129138,
  appSlug: "warplets",
  notificationUrl: "https://api.farcaster.xyz/notification",
  notificationToken: "token",
  notificationId: "warplets:global-stats:2026-08-26",
  title: "10X Warplets",
  body: "24hr Stats",
  targetUrl: "https://warplet.10x.meme/stats",
};

describe("Farcaster notification retry isolation", () => {
  it("retries a previously failed Farcaster delivery", async () => {
    const { db, statements } = retryDb("failed");
    const fetchMock = vi.fn(async () => Response.json({
      result: { successfulTokens: ["token"], invalidTokens: [], rateLimitedTokens: [], failedTokens: [] },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(dispatchNotification(db, options)).resolves.toEqual({ state: "success" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(statements.some((sql) => sql.includes("SET status = 'pending'"))).toBe(true);
  });

  it("does not resend a Farcaster delivery that already succeeded", async () => {
    const { db } = retryDb("delivered");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(dispatchNotification(db, options)).resolves.toEqual({ state: "success" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

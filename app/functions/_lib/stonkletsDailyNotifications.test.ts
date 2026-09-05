import { afterEach, describe, expect, it, vi } from "vitest";
import { runStonkletsDailyNotifications, type StonkletsDailyNotificationEnv } from "./stonkletsDailyNotifications";
import { dispatchNotification } from "./dispatch";
vi.mock("./dispatch", () => ({ dispatchNotification: vi.fn().mockResolvedValue({ state: "success" }) }));
const body = "Daily Top 3: +10% $BULL. +5% $SOXSB. -1% $QQQB.";
function fixture(locked = false, empty = false) {
  const queries: string[] = [];
  const values: unknown[][] = [];
  const db = { prepare: (sql: string) => {
    queries.push(sql);
    let args: unknown[] = [];
    const statement = {
      bind: (...bindings: unknown[]) => { args = bindings; values.push(bindings); return statement; },
      first: async () => {
        if (sql.includes("ON CONFLICT(job_key)")) return locked ? null : { value: args[1] };
        if (sql.includes("SELECT value")) return { value: body };
        if (sql.startsWith("UPDATE")) return { value: args[1] };
        return null;
      },
      all: async () => ({ results: empty ? [] : [{ fid: 123, notification_url: "https://example.com/notify", notification_token: "token" }] }),
      run: async () => ({ meta: { changes: 1 } }),
    };
    return statement;
  } };
  return { env: { WARPLETS: db, STONKLETS_DAILY_NOTIFICATIONS_ENABLED: "true" } as unknown as StonkletsDailyNotificationEnv, queries, values };
}
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
describe("Stonklets daily delivery", () => {
  it("does not query or send when disabled or before market close", async () => {
    const f = fixture();
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-08T19:00:00Z"));
    expect(await runStonkletsDailyNotifications(f.env)).toBe(0);
    f.env.STONKLETS_DAILY_NOTIFICATIONS_ENABLED = "false";
    expect(await runStonkletsDailyNotifications(f.env)).toBe(0);
    expect(f.queries).toEqual([]);
    expect(dispatchNotification).not.toHaveBeenCalled();
  });
  it("reuses the frozen campaign and selects only enabled Stonklets recipients needing delivery", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-08T20:00:00Z"));
    const f = fixture();
    expect(await runStonkletsDailyNotifications(f.env)).toBe(1);
    expect(dispatchNotification).toHaveBeenCalledWith(f.env.WARPLETS, expect.objectContaining({ appSlug: "stonklets", notificationId: "stonklets:daily-top:2026-09-08", body, fid: 123 }));
    const sql = f.queries.find(q => q.includes("FROM miniapp_notification_tokens"))!;
    expect(sql).toContain("t.app_slug = 'stonklets' AND t.enabled = 1");
    expect(sql).toContain("d.status NOT IN ('delivered', 'invalid')");
    expect(sql).toContain("d.attempt_count < 6");
    expect(f.queries.at(-1)).toContain("DELETE FROM notification_job_state WHERE job_key = ? AND value = ?");
  });
  it("does not send during an overlapping cron execution", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-08T20:00:00Z"));
    expect(await runStonkletsDailyNotifications(fixture(true).env)).toBe(0);
    expect(dispatchNotification).not.toHaveBeenCalled();
  });
  it("releases its lease even if delivery throws", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-08T20:00:00Z"));
    vi.mocked(dispatchNotification).mockRejectedValueOnce(new Error("database failure"));
    const f = fixture();
    await expect(runStonkletsDailyNotifications(f.env)).rejects.toThrow("database failure");
    expect(f.queries.at(-1)).toContain("DELETE FROM notification_job_state");
  });
});

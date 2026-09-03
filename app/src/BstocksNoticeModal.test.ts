import { describe, expect, it, vi } from "vitest";
import {
  BSTOCKS_NOTICE_STORAGE_KEY,
  hasAcceptedBstocksNotice,
  isBstocksNoticeForced,
  rememberBstocksNoticeAcceptance,
} from "./BstocksNoticeModal";

describe("bStocks notice persistence", () => {
  it("only forces the notice for explicit truthy test values", () => {
    expect(isBstocksNoticeForced("?bstocksNotice=1")).toBe(true);
    expect(isBstocksNoticeForced("?bstocksNotice=TRUE")).toBe(true);
    expect(isBstocksNoticeForced("?bstocksNotice=0")).toBe(false);
    expect(isBstocksNoticeForced("?other=1")).toBe(false);
  });

  it("recognizes and records the versioned acceptance value", () => {
    expect(hasAcceptedBstocksNotice({ getItem: () => "1" })).toBe(true);
    expect(hasAcceptedBstocksNotice({ getItem: () => null })).toBe(false);
    const setItem = vi.fn();
    rememberBstocksNoticeAcceptance({ setItem });
    expect(setItem).toHaveBeenCalledWith(BSTOCKS_NOTICE_STORAGE_KEY, "1");
  });

  it("fails closed when storage is unavailable", () => {
    expect(hasAcceptedBstocksNotice({ getItem: () => { throw new Error("blocked"); } })).toBe(false);
    expect(() => rememberBstocksNoticeAcceptance({ setItem: () => { throw new Error("blocked"); } })).not.toThrow();
  });
});

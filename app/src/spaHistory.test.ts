import { describe, expect, it, vi } from "vitest";
import { writeSpaHistory } from "./spaHistory";

function createHistoryWriter() {
  return {
    pushState: vi.fn(),
    replaceState: vi.fn(),
  };
}

describe("writeSpaHistory", () => {
  it("keeps normal browser push navigation", () => {
    const history = createHistoryWriter();

    expect(writeSpaHistory(history, { route: "stats" }, "/stats", {
      mode: "push",
      embedded: false,
    })).toBe("push");
    expect(history.pushState).toHaveBeenCalledWith({ route: "stats" }, "", "/stats");
    expect(history.replaceState).not.toHaveBeenCalled();
  });

  it("replaces embedded navigation so an iOS host cannot recreate the WebView", () => {
    const history = createHistoryWriter();

    expect(writeSpaHistory(history, { warplet: 1589 }, "/?warplet=1589", {
      mode: "push",
      embedded: true,
    })).toBe("replace");
    expect(history.replaceState).toHaveBeenCalledWith({ warplet: 1589 }, "", "/?warplet=1589");
    expect(history.pushState).not.toHaveBeenCalled();
  });

  it("honours an explicit replace outside embedded hosts", () => {
    const history = createHistoryWriter();

    expect(writeSpaHistory(history, null, "/?random=Sports", {
      mode: "replace",
      embedded: false,
    })).toBe("replace");
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/?random=Sports");
    expect(history.pushState).not.toHaveBeenCalled();
  });
});

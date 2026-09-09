import { describe, expect, it } from "vitest";
import { stonkletShareContentReady } from "./stonkletsShareReadiness";

function chart(ready = "true", canvases = [{ width: 400, height: 300 }], artwork?: { complete: boolean; naturalWidth: number }) {
  return { dataset: { chartReady: ready }, querySelectorAll: () => canvases, querySelector: () => artwork };
}
function root(charts = [chart(), chart()], blocked = false) {
  return { querySelector: () => blocked ? {} : null, querySelectorAll: () => charts } as unknown as ParentNode;
}
describe("share chart readiness", () => {
  it("requires both painted charts", () => {
    expect(stonkletShareContentReady(null)).toBe(false);
    expect(stonkletShareContentReady(root([]))).toBe(false);
    expect(stonkletShareContentReady(root([chart()]))).toBe(false);
    expect(stonkletShareContentReady(root())).toBe(true);
  });
  it("rejects spinners or unfinished artwork even if chart flags say ready", () => {
    expect(stonkletShareContentReady(root(undefined, true))).toBe(false);
  });
  it("rejects charts without an explicit ready state or a drawable canvas", () => {
    for (const pending of [chart("false"), chart(""), chart("true", []), chart("true", [{ width: 0, height: 300 }])]) {
      expect(stonkletShareContentReady(root([chart(), pending]))).toBe(false);
    }
  });
  it("allows hidden scale canvases when the plot canvas has painted", () => {
    expect(stonkletShareContentReady(root([chart(), chart("true", [{ width: 0, height: 0 }, { width: 400, height: 300 }])]))).toBe(true);
  });
  it("requires a loaded artwork image for an unlaunched token", () => {
    expect(stonkletShareContentReady(root([chart(), chart("artwork", [], { complete: false, naturalWidth: 0 })]))).toBe(false);
    expect(stonkletShareContentReady(root([chart(), chart("artwork", [], { complete: true, naturalWidth: 512 })]))).toBe(true);
  });
});

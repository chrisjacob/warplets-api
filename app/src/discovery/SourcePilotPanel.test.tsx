import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SourcePilotPanel } from "./SourcePilotPanel";
import { sourcePilotReadiness } from "../../../discovery/src/source-pilot-readiness";

describe("source pilot readiness", () => {
  it("shows the held state, provenance limits and shared budgets without activation", () => {
    const html = renderToStaticMarkup(<SourcePilotPanel data={sourcePilotReadiness()} />);
    for (const text of ["new collection is held", "zero provider requests", "does not change token scores", "Jupiter Tokens V2", "GeckoTerminal public API", "at most 20", "100 records / 10 MB", "No capacity is reserved", "do not authenticate a source", "no activation control"]) expect(html).toContain(text);
    expect(html).not.toContain("<button"); expect(html).not.toContain("<form");
  });
  it("does not turn an older service or failed refresh into ready/live status", () => {
    expect(renderToStaticMarkup(<SourcePilotPanel data={null} />)).toContain("has not been reported");
    expect(renderToStaticMarkup(<SourcePilotPanel data={null} error="unavailable" />)).toContain("Live collection status is unavailable");
    const stale = renderToStaticMarkup(<SourcePilotPanel data={sourcePilotReadiness()} error="unavailable" />);
    expect(stale).toContain("last response remains visible"); expect(stale).toContain("new collection is held");
  });
});

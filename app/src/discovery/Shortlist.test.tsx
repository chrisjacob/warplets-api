import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ShortlistNotice, ShortlistPanel, ShortlistToggle } from "./Shortlist";
import { createShortlistRepository, type ShortlistState } from "./shortlist-store";
import { fixtureCandidates } from "../../../discovery/src/fixtures";
import { assess, DEFAULT_POLICY } from "../../../discovery/src/model";
import { candidateCard } from "../../../discovery/src/candidate-card";
import { DiscoveryTable } from "./DiscoveryWorkspace";

const at = new Date("2026-10-22T01:00:00.000Z");
const empty: ShortlistState = { mode: "live", entries: [], status: "saved", message: "" };
const noop = () => {};
function panel(state: ShortlistState, candidates: Parameters<typeof ShortlistPanel>[0]["candidates"] = []) {
  return renderToStaticMarkup(<ShortlistPanel state={state} candidates={candidates} selected={[]} onRemove={noop} onClear={noop} onCompare={noop}/>);
}

it("explains empty, invalid and memory-only lists and never presents an operator credential control", () => {
  const html = panel(empty);
  expect(html).toContain("Saved tokens · 0 / 100");
  expect(html).toContain("Save for later on a card, table row or token page");
  expect(html).toContain("Saved only in this browser");
  expect(html).not.toContain('type="password"');
  expect(renderToStaticMarkup(<ShortlistNotice state={{ ...empty, status: "memory" }}/>)).toContain("until you reload or close this page");
  expect(panel({ ...empty, status: "memory" })).not.toContain('disabled=""');
  expect(panel({ ...empty, status: "invalid" })).toContain("It has not been overwritten");
});

it("keeps off-list tokens accessible by exact identity without cached scores, stale artwork hints or implied provider collection", async () => {
  const c = (await fixtureCandidates(at))[0]!, repo = createShortlistRepository(() => { throw Error("blocked"); });
  const state = repo.change("fixture", { type: "save", token: { ...c, name: "<img src=x onerror=alert(1)>" } }, at);
  const html = panel(state);
  expect(html).toContain("Saved simulation examples");
  expect(html).toContain("separate from your saved live tokens");
  expect(html).toContain(`/token/solana/${c.address}?mode=fixture`);
  expect(html).toContain("Outside current results");
  expect(html).toContain(c.address);
  expect(html).toContain("&lt;img");
  expect(html).not.toContain("<img src=x onerror=");
  expect(html).not.toContain("100 / 100");
  expect(html).toContain(`Compare mint ${c.address}`);
});

it("reuses current identity/artwork when available and provides an accessible saved toggle in the table", async () => {
  const c = candidateCard(assess((await fixtureCandidates(at))[0]!, DEFAULT_POLICY, at));
  const local = new Map<string, string>(), repo = createShortlistRepository(() => ({ getItem: k => local.get(k) ?? null, setItem: (k, v) => { local.set(k, v); }, removeItem: k => { local.delete(k); } }));
  const state = repo.change("fixture", { type: "save", token: c }, at);
  expect(panel(state, [c])).toContain("Shown in current results");
  const html = renderToStaticMarkup(<DiscoveryTable candidates={[c]} artwork={{}} scoredAt={at.toISOString()} shortlist={{ state, save: noop }}/>);
  expect(html).toContain(`Remove saved mint ${c.address}`);
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain("Saved · remove");
  expect(renderToStaticMarkup(<ShortlistToggle token={c} state={{ ...state, status: "invalid" }} onToggle={noop}/>)).toContain("disabled");
  expect(renderToStaticMarkup(<ShortlistToggle token={c} state={{ ...state, mode: "live" }} onToggle={noop}/>)).toContain("disabled");
});

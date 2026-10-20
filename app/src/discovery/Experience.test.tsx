import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ContentEmptyState, ContentPreviewNotice, SubmissionJourney, campaignPhase, type ReviewCampaign } from "./ContentJourney";
import { safeWalletReturn, solanaSignInHref, verifiedSignInReturn } from "./walletReturn";
import { creationAge, EligibilityOverview, TokenMarketOverview, WalletRiskSummary } from "./TokenOverview";
import { EvidenceDisclosure, revealEvidenceTarget } from "./EvidenceDisclosure";
import { SimulationNotice } from "./SimulationNotice";
import type { AssessedCandidate } from "../../../discovery/src/model";

const now = Date.parse("2026-10-21T02:00:00.000Z"), id = "00000000-0000-4000-8000-000000000001";
const campaign: ReviewCampaign = { id, title: "Community memes", chain: "solana", og_address: "So11111111111111111111111111111111111111112", starts_at: "2026-10-20T02:00:00.000Z", ends_at: "2026-10-30T02:00:00.000Z", kind: "local_review_only", rewards_enabled: false };

it("offers a useful browse empty state without admin controls, sign-in or a disabled submission form", () => {
  const html = renderToStaticMarkup(<><ContentPreviewNotice /><ContentEmptyState loading={false} /></>);
  expect(html).toContain("No campaigns yet"); expect(html).toContain('href="/discover"'); expect(html).toContain("submissions earn no rewards");
  expect(html).not.toContain("/admin/"); expect(html).not.toContain("<form"); expect(html).not.toContain("/wallets");
});
it.each([
  { signedIn: false, campaign: null, selected: "" },
  { signedIn: true, campaign: null, selected: "" },
  { signedIn: false, campaign, selected: id },
  { signedIn: true, campaign: { ...campaign, ends_at: "2026-10-21T02:00:00.000Z" }, selected: id },
  { signedIn: true, campaign: { ...campaign, starts_at: "2026-10-22T02:00:00.000Z" }, selected: id },
])("never mounts submission controls without both an open campaign and a signed identity ($signedIn/$selected)", state => {
  let mounted = false;
  function Form() { mounted = true; return <form><input name="source" /></form>; }
  const html = renderToStaticMarkup(<SubmissionJourney {...state} campaigns={[campaign]} loaded now={now}><Form /></SubmissionJourney>);
  expect(mounted).toBe(false); expect(html).not.toContain("<form");
  if (state.campaign === campaign && !state.signedIn) expect(html).toContain(solanaSignInHref(`/submit?campaign=${id}`).replaceAll("&", "&amp;"));
});
it("shows the actual form for an open campaign and signed identity, with no automatic sign-in", () => {
  const html = renderToStaticMarkup(<SubmissionJourney campaign={campaign} campaigns={[campaign]} loaded signedIn selected={id} now={now}><form><button>Submit for review</button></form></SubmissionJourney>);
  expect(html).toContain("<form"); expect(html).not.toContain("/wallets");
  expect(campaignPhase(campaign, Date.parse(campaign.starts_at))).toBe("open");
  expect(campaignPhase(campaign, Date.parse(campaign.ends_at))).toBe("closed");
});
it.each(["https://evil.example/submit", "//evil.example/submit", "/\\evil.example", "javascript:alert(1)", "/wallets?returnTo=/wallets", "/admin/10x", "/api/10x/admin/jobs", "/submit\n", "/%2f%2fevil.example", "/menu", "/submit" + "x".repeat(2049)])("rejects unsafe or unrelated sign-in return targets: %s", value => {
  expect(safeWalletReturn(value)).toBe("/discover");
});
it("preserves a campaign task and returns only after verified login, never a link/unlink or failed authentication", () => {
  const target = `/submit?campaign=${id}`;
  expect(safeWalletReturn(target)).toBe(target);
  for (const path of ["/", "/thesis", "/status#coverage", "/research", "/transparency", "/elections/saved-rehearsal", "/launch-lab", "/launch-recovery", "/rewards"]) expect(safeWalletReturn(path)).toBe(path);
  expect(verifiedSignInReturn("login", true, target)).toBe(target);
  expect(verifiedSignInReturn("login", false, target)).toBeNull();
  for (const intent of ["link", "unlink"]) expect(verifiedSignInReturn(intent, true, target)).toBeNull();
  expect(verifiedSignInReturn("login", true, null)).toBeNull();
  expect(verifiedSignInReturn("login", true, "//evil.example")).toBe("/discover");
});
it("keeps required blockers and known failures explicit rather than presenting a safety badge", () => {
  const pending = renderToStaticMarkup(<EligibilityOverview status="provisional" reasons={["pre_buy_funding_coverage_partial", "wallet_analysis_stale"]} />);
  expect(pending).toContain("Checks incomplete"); expect(pending).toContain("Funding history is incomplete"); expect(pending).toContain("Wallet checks need refreshing"); expect(pending).toContain("View all missing checks (2)");
  const excluded = renderToStaticMarkup(<EligibilityOverview status="excluded" reasons={["top_holder_concentration_high", "top10_concentration_high", "creator_concentration_high"]} />);
  for (const phrase of ["Largest owner exceeds", "Top ten owners exceed", "Creation user holds"]) expect(excluded).toContain(phrase);
  expect(excluded).not.toContain("<details");
  expect(renderToStaticMarkup(<EligibilityOverview status="eligible" reasons={[]} />)).toContain("not a safety rating");
});
it("keeps missing cap distinct from FDV, labels stale saved data and refuses to invent an age", () => {
  const html = renderToStaticMarkup(<TokenMarketOverview now={now} candidate={{ creation: null, market: { source: "dexscreener", fetched_at: "2026-10-20T02:00:00.000Z", observed_at: null, price_usd: 0.1, market_cap_usd: null, fdv_usd: 99_000_000, liquidity_usd: 42_000, volume_24h_usd: null, image_url: null } }} />);
  expect(html).toContain("Reported market cap</dt><dd>Unavailable"); expect(html).not.toContain("99,000,000"); expect(html).toContain("Stale or invalid timestamp"); expect(html).toContain("Created</dt><dd>Unknown");
  expect(creationAge("bad", now)).toBe("Unknown"); expect(creationAge(new Date(now + 1).toISOString(), now)).toBe("Unknown"); expect(creationAge(new Date(now - 3_600_000).toISOString(), now)).toBe("1h ago");
});
it("shows all saved wallet relationship signals as review evidence and escapes untrusted text", () => {
  const candidate = { wallet_analysis: { status: "signals_detected", signals: [{ code: "shared_creation_and_buyer_funder" }, { code: "<script>fake signal</script>" }] } } as AssessedCandidate;
  const html = renderToStaticMarkup(<WalletRiskSummary candidate={candidate} />);
  expect(html).toContain("do not prove common control"); expect(html).toContain("share an observed direct funder"); expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>"); expect(html).toContain('href="#wallet-analysis"');
});
it("uses closed native evidence panels while retaining their target content for anchors", () => {
  const html = renderToStaticMarkup(<EvidenceDisclosure id="wallet-evidence" title="Wallet evidence"><section id="second-hop">Saved transfers</section></EvidenceDisclosure>);
  expect(html).toContain('id="second-hop"'); expect(html).not.toMatch(/<details[^>]*\bopen[= >]/);
});
it("reveals the full ancestor chain for an evidence deep link, without opening siblings or interpreting selectors", () => {
  const outer = { open: false, tagName: "DETAILS", parentElement: null }, inner = { open: false, tagName: "DETAILS", parentElement: outer }, target = { tagName: "SECTION", parentElement: inner };
  const details = Object.assign(outer, { contains: (node: unknown) => [outer, inner, target].includes(node as typeof target), ownerDocument: { getElementById: (id: string) => id === "second-hop" ? target : null } });
  expect(revealEvidenceTarget(details as unknown as HTMLDetailsElement, "#second-hop")).toBe(target); expect(inner.open).toBe(true); expect(outer.open).toBe(true);
  outer.open = false; inner.open = false;
  expect(revealEvidenceTarget(details as unknown as HTMLDetailsElement, "#bad%ZZ")).toBeNull(); expect(revealEvidenceTarget(details as unknown as HTMLDetailsElement, '#second-hop"]')).toBeNull(); expect(outer.open).toBe(false);
});
it("keeps the same visible simulation boundary across labs while collapsing methodology", () => {
  const html = renderToStaticMarkup(<SimulationNotice><p>Experimental allocations</p></SimulationNotice>);
  expect(html).toContain("Simulation — no real votes or rewards"); expect(html).toContain("No tokens are launched or funds moved"); expect(html).toContain("About this simulation"); expect(html).not.toMatch(/<details[^>]*\bopen[= >]/);
});

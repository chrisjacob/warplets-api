import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DiscoveryNav } from "./DiscoveryNav";
import { CollectionDetails, isCollectionAnchor } from "./CollectionDetails";

it("keeps three primary destinations and retains all research and local tools in a closed native disclosure", () => {
  const html = renderToStaticMarkup(<DiscoveryNav path="/discover" />);
  const primary = html.slice(0, html.indexOf("<details"));
  expect(primary.match(/<a /g)).toHaveLength(3);
  expect(primary).toContain('href="/discover" aria-current="page"');
  expect(primary).not.toContain("Admin");
  expect(html).toContain('<details class="tenx-more"');
  expect(html).not.toMatch(/<details[^>]*\bopen[= >]/);
  for (const route of ["/history", "/research", "/elections", "/status", "/transparency", "/backing", "/launch-lab", "/launch-recovery", "/rewards", "/admin/10x", "/thesis"]) expect(html).toContain(`href="${route}"`);
  expect(html).toContain("The 10X Thesis");
  expect(html).toContain("Tools · local simulations");
});

it.each([
  ["/token/solana/mint", "/discover"],
  ["/campaign/00000000-0000-4000-8000-000000000001", "/attention"],
  ["/submit", "/attention"],
  ["/elections/saved-rehearsal", "/elections"],
  ["/admin/10x", "/admin/10x"],
])("indicates the current section for %s without losing its destination", (path, href) => {
  const html = renderToStaticMarkup(<DiscoveryNav path={path!} />);
  expect(html).toContain(`href="${href}" aria-current="page"`);
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  if (href === "/elections" || href === "/admin/10x") expect(html).toContain("More navigation, current section:");
});

it("does not mount diagnostic collectors until expanded and recognizes existing collection anchors exactly", () => {
  let mounted = false;
  function Collector() { mounted = true; return <p>Private test collector</p>; }
  const html = renderToStaticMarkup(<CollectionDetails><Collector /></CollectionDetails>);
  expect(mounted).toBe(false);
  expect(html).toContain('id="coverage"');
  expect(html).toContain("Data &amp; collection details");
  expect(html).not.toContain("test collector");
  for (const hash of ["#coverage", "#wallet-coverage-plan"]) expect(isCollectionAnchor(hash)).toBe(true);
  for (const hash of ["", "#wallet-analysis", "#coverage-other", "#coverage%22"]) expect(isCollectionAnchor(hash)).toBe(false);
});

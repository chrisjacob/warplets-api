import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TenxAppMenuLinks } from "./TenxAppMenuLinks";

it("offers the thesis at the root without any unfinished account-menu entry when closed", () => {
  const html = renderToStaticMarkup(<TenxAppMenuLinks enabled={false} onNavigate={() => {}} />);
  expect(html).toContain('href="/"');
  expect(html).toContain("The 10X Thesis");
  expect(html.match(/<a /g)).toHaveLength(1);
  expect(html).not.toMatch(/trending|discover|wallets|Solana/);
});

it("retains local discovery and the validated wallet return destination when enabled", () => {
  const html = renderToStaticMarkup(<TenxAppMenuLinks enabled walletHref="/wallets?returnTo=%2Fresearch" onNavigate={() => {}} />);
  for (const path of ["/trending", "/thesis", "/wallets?returnTo=%2Fresearch"]) expect(html).toContain(`href="${path}"`);
  expect(html).not.toContain('href="/discover"');
});

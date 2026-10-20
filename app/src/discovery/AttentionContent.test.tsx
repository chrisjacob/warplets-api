import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ContentLink } from "./AttentionContent";
it("renders untrusted author/comment as text and external links without embedding or referrer access", () => {
  const html = renderToStaticMarkup(<ContentLink item={{ content: { canonical_url: "https://example.com/post", platform: "web", category: "meme", author_claim: '<img src=x onerror="alert(1)">', comment: "<script>steal()</script>", permission_to_feature: true, rights_confirmed: true }, status: "VISIBLE", updated_at: "2026-10-21T00:00:00.000Z", revision: 1 }} />);
  expect(html).toContain("&lt;img"); expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<img"); expect(html).not.toContain("<script"); expect(html).not.toContain("<iframe");
  expect(html).toContain('rel="ugc nofollow noopener noreferrer"'); expect(html).toContain('referrerPolicy="no-referrer"');
  expect(html).toContain("unverified"); expect(html).toContain("no reward credit");
});

import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ContentLink } from "./AttentionContent";
import {ContentReportForm,ReportClaim} from "./ContentReports";
import {ReportSnapshot} from "../../../discovery/src/content-report-model";
it("renders untrusted author/comment as text and external links without embedding or referrer access", () => {
  const html = renderToStaticMarkup(<ContentLink item={{ content: { canonical_url: "https://example.com/post", platform: "web", category: "meme", author_claim: '<img src=x onerror="alert(1)">', comment: "<script>steal()</script>", permission_to_feature: true, rights_confirmed: true }, status: "VISIBLE", updated_at: "2026-10-21T00:00:00.000Z", revision: 1 }} />);
  expect(html).toContain("&lt;img"); expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<img"); expect(html).not.toContain("<script"); expect(html).not.toContain("<iframe");
  expect(html).toContain('rel="ugc nofollow noopener noreferrer"'); expect(html).toContain('referrerPolicy="no-referrer"');
  expect(html).toContain("unverified"); expect(html).toContain("no reward credit");
});
it("keeps report controls gated by sign-in and renders private claims as text without fetching or embedding references",()=>{
  const form=renderToStaticMarkup(<ContentReportForm submissionId="00000000-0000-4000-8000-000000000001" signedIn={false}/>);
  expect(form).toContain("fieldset disabled");expect(form).toContain("Reports alone do not remove content");expect(form).toContain("Supporting URLs are not fetched");
  const at="2026-10-21T00:00:00.000Z",item=ReportSnapshot.parse({id:"00000000-0000-4000-8000-000000000001",submission_id:"00000000-0000-4000-8000-000000000002",reporter_identity_id:"00000000-0000-4000-8000-000000000003",category:"impersonation",reason:'<script>send secrets()</script>',evidence_url:"https://example.com/evidence",target_url:"https://example.com/post",target_content_hash:"a".repeat(64),good_faith:true,created_at:at,updated_at:at,revision:0,status:"OPEN"});
  const claim=renderToStaticMarkup(<ReportClaim item={item}/>);expect(claim).toContain("&lt;script&gt;");expect(claim).not.toContain("<script");expect(claim).not.toContain("<iframe");expect(claim).toContain("remain unverified");expect(claim).toContain('referrerPolicy="no-referrer"');
});

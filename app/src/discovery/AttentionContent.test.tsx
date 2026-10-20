import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ContentLink } from "./AttentionContent";
import {ContentReportForm,ReportClaim} from "./ContentReports";
import {ReportSnapshot} from "../../../discovery/src/content-report-model";
import {HoldReviewsPanel,HoldReviewMessage} from "./ContentHoldReviews";
import {HoldReviewEvent} from "../../../discovery/src/content-hold-model";
import {ContentOperationsPanel} from "./ContentOperations";
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
it("gates contributor review administration and renders contributor-visible replies as text",()=>{
  const html=renderToStaticMarkup(<HoldReviewsPanel token=""/>);expect(html).toContain("Contributor hold reviews");expect(html).toContain("select disabled");expect(html).toContain("never releases a hold");expect(html).toContain("Do not copy reporter identities");
  const at="2026-10-21T00:00:00.000Z",id="00000000-0000-4000-8000-000000000001",event=HoldReviewEvent.parse({id,review_id:id,revision:0,actor:"00000000-0000-4000-8000-000000000003",action:"request",note:"<script>copy private data()</script>",reference_url:"https://example.com/public",created_at:at,request_hash:"a".repeat(64),previous_hash:null,hash:"b".repeat(64),snapshot:{id,submission_id:"00000000-0000-4000-8000-000000000002",owner_identity_id:"00000000-0000-4000-8000-000000000003",target_url:"https://example.com/post",target_content_hash:"c".repeat(64),hold_set_hash:"d".repeat(64),created_at:at,updated_at:at,revision:0,status:"OPEN"}});
  const message=renderToStaticMarkup(<HoldReviewMessage event={event}/>);expect(message).toContain("&lt;script&gt;");expect(message).not.toContain("<script");expect(message).not.toContain("<iframe");expect(message).toContain('rel="ugc nofollow noopener noreferrer"');expect(message).toContain('referrerPolicy="no-referrer"');expect(message).toContain("remain unverified");
});
it("requires the operator token before loading private content operations",()=>{
  const html=renderToStaticMarkup(<ContentOperationsPanel token=""/>);
  expect(html).toContain("Content operations · private");expect(html).toContain("button class=\"tenx-button\" disabled");expect(html).toContain("Enter the operator token");expect(html).not.toContain("<table");expect(html).toContain("no moderation, eligibility or reward decisions");
});

import {expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {MintReviewsPanel} from "./MintReviewsPanel";
import {MintReviewsResponse,MINT_REVIEW_LIMITS} from "../../../discovery/src/mint-review-model";
const at="2026-10-21T00:00:00.000Z",address="CSocnzcRpgSCr1naKcNTieWZUxb6rABe45j844m7pump";
const base={at,reviews:[],limits:MINT_REVIEW_LIMITS,reserved_today:0,provider_requests:0,evidence_gates_changed:false};
it("keeps admission separate from eligibility and links evidence without inventing a candidate",()=>{
  const data=MintReviewsResponse.shape.data.parse({...base,reviews:[{address,curve:address,state:"admitted",queued_at:at,updated_at:at,pages:1,bodies_checked:1,migration_signature:"1".repeat(64),quote:address,last_error:null,candidate_present:false}]});
  const html=renderToStaticMarkup(<MintReviewsPanel data={data} error=""/>);
  expect(html).toContain("Migration found · normal evidence checks still required");expect(html).toContain("No candidate has been saved");expect(html).not.toContain(`/token/solana/${address}`);expect(html).toContain("zero provider requests");expect(html).toContain("inside its existing six-body limit");expect(html).toContain('rel="noopener noreferrer"');
});
it("exposes unsupported quotes and failed refreshes while retaining saved results",()=>{
  const data=MintReviewsResponse.shape.data.parse({...base,reviews:[{address,curve:address,state:"unsupported_quote",queued_at:at,updated_at:at,pages:1,bodies_checked:1,migration_signature:null,quote:address,last_error:"unsupported_quote",candidate_present:false}]});
  const html=renderToStaticMarkup(<MintReviewsPanel data={data} error="offline"/>);expect(html).toContain("Quote asset is not supported");expect(html).toContain("The last response remains visible");expect(html).toContain("only WSOL-quoted migrations");
});
it("distinguishes loading, failure and an empty queue",()=>{
  expect(renderToStaticMarkup(<MintReviewsPanel data={null} error=""/>)).toContain("Reading saved token review status");expect(renderToStaticMarkup(<MintReviewsPanel data={null} error="offline"/>)).toContain('role="alert"');expect(renderToStaticMarkup(<MintReviewsPanel data={MintReviewsResponse.shape.data.parse(base)} error=""/>)).toContain("No exact-mint reviews");
});

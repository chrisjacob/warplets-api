import {it,expect} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {ContentDuplicatesPanel,DuplicateComparison} from "./ContentDuplicates";
import {DuplicateReport,DUPLICATE_ALGORITHM,DUPLICATE_GAPS} from "../../../discovery/src/content-duplicates-model";
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
function fixture(matches=true){
  const sample=(n:number)=>{
    const target={submission_id:id(n),source_url:`https://example.com/excerpts/${n}`,target_content_hash:"a".repeat(64)};
    return {version:"operator-excerpt-evidence-v1",target,events:[{id:id(n+100),submission_id:target.submission_id,revision:0,created_at:"2026-10-20T00:00:00.000Z",actor:"local_operator",action:"RECORD",source_url:target.source_url,target_content_hash:target.target_content_hash,excerpt:"<script>private excerpt()</script> <img src=x onerror=steal()> long source text fixture",normalized_excerpt_hash:"a".repeat(64),source_inspected:true,reason:"Private operator notes must stay out of summary rendering",request_hash:"b".repeat(64),previous_hash:null,hash:"c".repeat(64)}],replay:"verified",source_requests:0,reward_eligible:false};
  };
  return DuplicateReport.parse({version:"private-duplicate-report-v1",captured_at:"2026-10-20T01:00:00.000Z",algorithm:DUPLICATE_ALGORITHM,subject:sample(1),candidates:matches?[sample(2)]:[],
    coverage:{scope:"latest_active_operator_excerpts_across_campaigns",sample_limit:50,available_candidates:matches?1:0,compared:matches?1:0,omitted:0,sample_complete:true,external_content_complete:false},
    result:{matching_candidates:matches?1:0,matches:matches?[{submission_id:id(2),source_url:"https://example.com/excerpts/2",evidence_id:id(102),evidence_hash:"c".repeat(64),kind:"EXACT_NORMALIZED_EXCERPT",score_bps:10000,shared_grams:50,union_grams:50}]:[]},gaps:DUPLICATE_GAPS,source_requests:0,automatic_decisions:false,rewards_enabled:false,report_hash:"d".repeat(64)});
}
it("requires operator access and explicit source inspection before recording private evidence",()=>{
  const html=renderToStaticMarkup(<ContentDuplicatesPanel token=""/>);
  expect(html).toContain("Near-duplicate excerpt evidence · private");expect(html).toContain("input disabled");expect(html).toContain('button class="tenx-button" disabled');expect(html).toContain("Enter the operator token");
  expect(html).toContain("Author claims and submission commentary are not treated as source content");expect(html).toContain("Image, video and audio similarity remain unavailable");expect(html).not.toContain("Download confidential comparison JSON");expect(html).not.toContain("Private evidence explanation");
});
it("renders private excerpts as escaped text with explicit review-only meaning and safe source links",()=>{
  const html=renderToStaticMarkup(<DuplicateComparison data={fixture()}/>);
  expect(html).toContain("Same normalized excerpt");expect(html).toContain("100.00%");expect(html).toContain("&lt;script&gt;");expect(html).toContain("&lt;img");expect(html).not.toContain("<script");expect(html).not.toContain("<img");expect(html).not.toContain("<iframe");
  expect(html).toContain('rel="ugc nofollow noopener noreferrer"');expect(html).toContain('referrerPolicy="no-referrer"');expect(html).toContain("Does not prove plagiarism");expect(html).not.toContain("Private operator notes must stay out");
});
it("does not turn a zero-match result into proof of originality or complete coverage",()=>{
  const html=renderToStaticMarkup(<DuplicateComparison data={fixture(false)}/>);
  expect(html).toContain("0 of 0 other active recorded excerpts");expect(html).toContain("A zero-match result does not establish originality");expect(html).toContain("External content coverage remains incomplete");expect(html).toContain("unobserved content remains unknown");
});

import {describe,it,expect} from "vitest";
import {DuplicateEvent,DuplicateRequest,DuplicateEvidence,DuplicatePayload,DUPLICATE_MAX_BYTES} from "./content-duplicates-model";
import {normalizeExcerpt,excerptGrams,scoreExcerpts,verifyDuplicateEvidence,makeDuplicateReport,verifyDuplicateReport,duplicateSize} from "./content-duplicates-math";
import {hashJson} from "./solana";
const alphabet="abcdefghijklmnopqrstuvwxyz",source=alphabet.repeat(3),different=[...alphabet].reverse().join("").repeat(3);
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
async function evidence(n:number,text=source){
  const input=DuplicateRequest.parse({request_id:id(n+1000),submission_id:id(n),expected_revision:-1,action:"RECORD",excerpt:text,source_inspected:true,reason:"Synthetic operator-inspected excerpt fixture"});
  const target={submission_id:id(n),source_url:`https://example.com/content/${n}`,target_content_hash:"a".repeat(64)};
  const value=DuplicateEvent.omit({hash:true}).parse({id:input.request_id,revision:0,created_at:"2026-10-20T00:00:00.000Z",actor:"local_operator",action:input.action,...target,excerpt:text,normalized_excerpt_hash:await hashJson(normalizeExcerpt(text)),source_inspected:true,reason:input.reason,request_hash:await hashJson(input),previous_hash:null});
  // target.submission_id is shared; source_url/hash are deliberate immutable anchors.
  return DuplicateEvidence.parse({version:"operator-excerpt-evidence-v1",target,events:[{...value,hash:await hashJson(value)}],replay:"verified",source_requests:0,reward_eligible:false});
}
const ordered=(values:Awaited<ReturnType<typeof evidence>>[])=>values.sort((a,b)=>a.events[0]!.id>b.events[0]!.id?-1:1);
const captured="2026-10-20T01:00:00.000Z";
async function rehash(value:Awaited<ReturnType<typeof makeDuplicateReport>>){const {report_hash:_h,...raw}=value,payload=DuplicatePayload.parse(raw);return {...payload,report_hash:await hashJson(payload)};}
describe("local source-excerpt similarity",()=>{
  it("normalizes compatibility characters, case, punctuation and zero-width formatting without using author claims",()=>{
    const a="Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron";
    const b="  ＡＬＰＨＡ — BETA, GAMMA! delta epsilon zeta eta theta iota kappa lambda mu nu xi omi\u200bcron. ";
    expect(normalizeExcerpt(b)).toBe(normalizeExcerpt(a));expect(scoreExcerpts(a,b).kind).toBe("EXACT_NORMALIZED_EXCERPT");expect(scoreExcerpts(a,b).score_bps).toBe(10000);
  });
  it("matches hand-counted distinct five-character windows and integer Jaccard scores",()=>{
    // Repeated alphabet has 26 distinct windows. Appending five new digits
    // creates exactly five more windows; the set intersection stays 26.
    expect(excerptGrams(source).grams.size).toBe(26);
    expect(scoreExcerpts(source,source+"12345")).toEqual({kind:"SIMILAR_EXCERPT",score_bps:8387,shared_grams:26,union_grams:31});
    expect(scoreExcerpts(source,different)).toEqual({kind:"SIMILAR_EXCERPT",score_bps:0,shared_grams:0,union_grams:52});
  });
  it.each(["", "Tiny copied caption", "a".repeat(100), "!!! ".repeat(60), "🎨".repeat(70)])("rejects insufficient normalized evidence (%s)",text=>{expect(()=>excerptGrams(text)).toThrow();});
  it("supports non-Latin letters without treating translation or media as measured",()=>{
    const text="春夏秋冬山川草木天地日月星辰風雨雷電海空森林河流城市朋友故事旅程希望歡笑光明夢想文化生活自然科學音樂藝術時間世界和平未來探索創造記憶";
    expect(scoreExcerpts(text,text).score_bps).toBe(10000);
  });
  it("produces deterministic ranked exact/near matches and retains below-threshold inputs for offline replay",async()=>{
    const subject=await evidence(1),candidates=ordered([await evidence(2,source+"12345"),await evidence(3),await evidence(4,different)]);
    const report=await makeDuplicateReport(subject,candidates,3,captured);
    expect(report.result.matching_candidates).toBe(2);expect(report.result.matches.map(m=>m.submission_id)).toEqual([id(3),id(2)]);expect(report.result.matches.map(m=>m.score_bps)).toEqual([10000,8387]);
    expect(report.candidates).toHaveLength(3);expect(report.coverage).toMatchObject({compared:3,omitted:0,sample_complete:true,external_content_complete:false});expect(report.automatic_decisions).toBe(false);
    expect(await verifyDuplicateReport(JSON.parse(JSON.stringify(report)),report.report_hash)).toEqual(report);
  });
  it("shows the top ten matches while reporting all matched candidates with stable tie ordering",async()=>{
    const report=await makeDuplicateReport(await evidence(1),ordered(await Promise.all(Array.from({length:15},(_,i)=>evidence(i+2)))),15,captured);
    expect(report.result.matching_candidates).toBe(15);expect(report.result.matches).toHaveLength(10);expect(report.result.matches.map(m=>m.submission_id)).toEqual(Array.from({length:10},(_,i)=>id(i+2)));
  });
  it("labels a capped sample honestly, including zero matches and unobserved content",async()=>{
    const report=await makeDuplicateReport(await evidence(1),ordered(await Promise.all(Array.from({length:50},(_,i)=>evidence(i+2,different)))),53,captured);
    expect(report.result.matches).toEqual([]);expect(report.coverage).toMatchObject({compared:50,omitted:3,sample_complete:false,external_content_complete:false});expect(report.gaps.join(" ")).toContain("not proof of plagiarism");
    expect(await verifyDuplicateReport(report)).toEqual(report);
  });
  it.each(["score","removed_match","input_hash","request_hash","source_url","actor","coverage","candidate_order","duplicate_candidate","future","algorithm"])("rejects %s tampering after recomputing the outer checksum",async(kind)=>{
    const value=await makeDuplicateReport(await evidence(1),ordered([await evidence(2),await evidence(3,source+"12345")]),2,captured);
    if(kind==="score")value.result.matches[0]!.score_bps=1;
    if(kind==="removed_match")value.result.matches.pop();
    if(kind==="input_hash")value.candidates[0]!.events[0]!.excerpt=different;
    if(kind==="request_hash"){const event=value.candidates[0]!.events[0]!;event.request_hash="b".repeat(64);const {hash:_h,...unsigned}=event;event.hash=await hashJson(unsigned);}
    if(kind==="source_url")value.candidates[0]!.target.source_url="https://example.com/other";
    if(kind==="actor")Object.assign(value.candidates[0]!.events[0]!,{actor:"contributor"});
    if(kind==="coverage")value.coverage.available_candidates=3;
    if(kind==="candidate_order")value.candidates.reverse();
    if(kind==="duplicate_candidate")value.candidates[1]=value.candidates[0]!;
    if(kind==="future")value.captured_at="2026-10-19T23:00:00.000Z";
    if(kind==="algorithm")Object.assign(value.algorithm,{review_threshold_bps:1});
    if(kind==="actor"||kind==="algorithm"){await expect(verifyDuplicateReport(value)).rejects.toThrow();return;}
    await expect(verifyDuplicateReport(await rehash(value))).rejects.toThrow();
  });
  it("rejects evidence without a retained first record or an active subject",async()=>{
    const subject=await evidence(1);subject.events=[];await expect(makeDuplicateReport(subject,[],0,captured)).rejects.toThrow("active_excerpt_required");
    const other=await evidence(2);other.events[0]!.revision=1;await expect(verifyDuplicateEvidence(other)).rejects.toThrow();
  });
  it("fails count/byte bounds before expensive replay and supports independently retained checksums",async()=>{
    expect(()=>duplicateSize({payload:"語".repeat(DUPLICATE_MAX_BYTES/2)})).toThrow("size_exceeded");
    const report=await makeDuplicateReport(await evidence(1),[],0,captured);await expect(verifyDuplicateReport(report,"b".repeat(64))).rejects.toThrow();
    const value={...report,candidates:Array(51).fill(await evidence(2))};await expect(verifyDuplicateReport(value)).rejects.toThrow();
  });
});

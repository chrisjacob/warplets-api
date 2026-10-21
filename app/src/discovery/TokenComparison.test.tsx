import {expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {comparisonSelection,toggleComparison,ComparisonToggle,ComparisonActivityCell,ComparisonValues,TokenComparison} from "./TokenComparison";
import {discoveryView,discoveryViewParams,discoveryCandidatesUrl} from "./DiscoveryWorkspace";
import {activityObservation} from "../../../discovery/src/activity-observation";
import {fixtureCandidates} from "../../../discovery/src/fixtures";
import {assess,DEFAULT_POLICY} from "../../../discovery/src/model";
import {candidateCard} from "../../../discovery/src/candidate-card";
import {defaultScoreInputV4,freezeDiscoveryScoreV4,scoreSummaryV4} from "../../../discovery/src/discovery-score-v4";
import {DiscoveryComparison,verifyDiscoveryComparison} from "../../../discovery/src/discovery-comparison-model";
import {hashJson} from "../../../discovery/src/solana";

const mints=["So11111111111111111111111111111111111111112","11111111111111111111111111111111","TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA","ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"],cutoff="2026-10-21T09:05:00.000Z";
it("bounds unique mint selections to three, removes independently and round-trips URL state without refetching the discovery list",()=>{
  let selected:string[]=[];for(const mint of mints)selected=toggleComparison(selected,mint);expect(selected).toEqual(mints.slice(0,3));expect(toggleComparison(selected,mints[1]!)).toEqual([mints[0],mints[2]]);
  for(const raw of [mints.join(","),mints[0]+","+mints[0],"../../keys","not a mint"])expect(comparisonSelection(raw)).toEqual([]);
  const view={...discoveryView(""),compare:selected},copy=discoveryView("?"+discoveryViewParams(view));expect(copy).toEqual(view);expect(new URL(discoveryCandidatesUrl(view),"https://app-local.10x.meme").searchParams.has("compare")).toBe(false);expect(discoveryCandidatesUrl(view)).toBe(discoveryCandidatesUrl({...view,compare:[]}));
});
it("disables a fourth selection while keeping existing selections removable and identity-specific",()=>{
  const full=renderToStaticMarkup(<ComparisonToggle address={mints[3]!} selected={mints.slice(0,3)} onToggle={()=>{}}/>);expect(full).toContain('disabled=""');expect(full).toContain(`Compare mint ${mints[3]}`);expect(full).toContain('aria-pressed="false"');
  const selected=renderToStaticMarkup(<ComparisonToggle address={mints[0]!} selected={mints.slice(0,3)} onToggle={()=>{}}/>);expect(selected).not.toContain('disabled=""');expect(selected).toContain('aria-pressed="true"');
  const tray=renderToStaticMarkup(<TokenComparison selected={[mints[0]!]} candidates={[]} mode="live" onRemove={()=>{}}/>);expect(tray).toContain("1 / 3");expect(tray).toContain("Compare saved observations");expect(tray).toContain('disabled=""');
});
it("shows unknown qualification and real scope/window without presenting raw volume as organic demand",()=>{
  const held=activityObservation({address:mints[0]!,cutoff_at:cutoff,metric:"organic_volume_24h",source:"unavailable",unit:"USD"},{qualification:"held",gaps:["organic_volume_qualification_not_established"]});
  const html=renderToStaticMarkup(<ComparisonActivityCell record={held}/>);expect(html).toContain("Unknown");expect(html).not.toContain("$0");expect(html).toContain("held");expect(html).toContain("Measurement window unknown");expect(html).toContain("adds no score credit");
  const wallet=activityObservation({address:mints[0]!,cutoff_at:cutoff,metric:"wallet_reported_buy_usd",source:"gmgn",unit:"USD"},{value:12,qualification:"reported_only",scope:{kind:"wallet",address:mints[1]!,canonical_pool_verified:false},fetched_at:cutoff,window:{kind:"observed_interval",start_at:"2026-10-21T09:00:00.000Z",end_at:"2026-10-21T09:01:00.000Z",duration_seconds:60},gaps:["selected_wallet_not_token_volume"]});
  const cell=renderToStaticMarkup(<ComparisonActivityCell record={wallet}/>);for(const text of ["$12","Scope: wallet","Selected wallet",mints[1]!,"selected wallet not token volume","Window &amp; evidence"])expect(cell).toContain(text);
});
it("renders two tokens at one cutoff, preserves distinct mint identities and verifies the displayed snapshot",async()=>{
  const at=new Date(cutoff),candidate=(await fixtureCandidates(at))[0]!,score=await freezeDiscoveryScoreV4(defaultScoreInputV4(candidate,at));
  const card=candidateCard({...assess(candidate,DEFAULT_POLICY,at),discovery_score:scoreSummaryV4(score)});
  const payload={version:"discovery-comparison-v1",cutoff_at:cutoff,mode:"fixture",addresses:[candidate.address,mints[0]!],rows:[{address:candidate.address,state:"available",candidate:card,candidate_hash:await hashJson(candidate),observations:[],gaps:[]},{address:mints[0]!,state:"not_found",candidate:null,candidate_hash:null,observations:[],gaps:["outside_saved_inventory_no_provider_lookup"]}],alignment:"shared_read_cutoff_source_windows_differ",source_authenticity:"not_independently_verified",scoring_model:"discovery-score-v4",activity_scoring_effect:"none",evidence_gates_changed:false,provider_requests:0,database_writes:0};
  const report=DiscoveryComparison.parse({...payload,report_hash:await hashJson(payload)});expect(await verifyDiscoveryComparison(report)).toEqual(report);
  const html=renderToStaticMarkup(<ComparisonValues report={report}/>);for(const text of ["Common review cutoff","Source windows and population coverage differ",candidate.address,mints[0]!,"Qualified organic volume","Raw owner change","SIMULATION","Full mint","scope=\"col\"","scope=\"row\""])expect(html).toContain(text);
  expect(html).toContain('role="region"');expect(html).not.toContain("Discovery rank #1");
});

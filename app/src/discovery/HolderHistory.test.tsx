import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HolderHistory, HolderHistoryValues } from "./HolderHistory";
import { HolderHistoryReportSchema } from "../../../discovery/src/holder-history-model";

const hash="a".repeat(64), other="b".repeat(64), at="2026-10-21T08:00:00.000Z", end="2026-10-21T09:00:00.000Z";
function report(){return HolderHistoryReportSchema.parse({version:"holder-history-v1",address:"So11111111111111111111111111111111111111112",cutoff_at:end,requested_start:"2026-10-20T09:00:00.000Z",
  status:"available",archive_records:2,archive_limit:96,selection:"first_and_latest_two_within_24h",snapshots:[{payload_hash:hash,observed_at:at,context_slot:100,mint_slot:101,
    pool:"So11111111111111111111111111111111111111112",program:"So11111111111111111111111111111111111111112",supply_raw:"1000",account_count:3,raw_owner_count:2,complete:true,layout_certified:true,acquisition_provenance:"unknown",gaps:[]}],
  since_first:{status:"measured",start_at:at,end_at:end,duration_seconds:3600,start_hash:hash,end_hash:other,starting_owners:3,ending_owners:2,entrants:1,exits:2,retained:1,net_change:-1,raw_growth_pct:-100/3,positive_balance_retention_pct:100/3,gaps:[]},
  recent:null,stale:false,gaps:["voluntary_acquisition_unknown"],input_hash:hash,report_hash:other,meaningful_holder_growth:null,trailing_24h_holder_growth:null,since_creation_holder_growth:null,
  organic_demand_certified:false,acquisition_provenance:"unknown",continuous_coverage:false,scoring_effect:"none",evidence_gates_changed:false,provider_requests:0,database_writes:0});}
describe("holder history evidence",()=>{
  it("labels raw entrants, exits, net loss and retention without qualified daily growth or points",()=>{
    const html=renderToStaticMarkup(<HolderHistoryValues data={report()}/>);
    for(const text of ["Meaningful holder growth: unknown","Unsolicited dust","Raw growth adds no scoring credit","1 entrant","2 exits","net -1","-33.33%","1 starting owners","not certified 24h or since-creation growth","scores and action checks remain unchanged"])expect(html).toContain(text);
  });
  it("shows missing and zero baselines separately and marks stale inventories",()=>{
    const data=report();data.since_first=null;data.stale=true;
    expect(renderToStaticMarkup(<HolderHistoryValues data={data}/>)).toContain("A second comparable inventory is needed");
    data.snapshots=[];data.status="no_history";
    const missing=renderToStaticMarkup(<HolderHistoryValues data={data}/>);expect(missing).toContain("missing baseline is unknown, not zero");expect(missing).toContain("Latest inventory stale");
    const zero=report();zero.since_first={...zero.since_first!,starting_owners:0,raw_growth_pct:null,positive_balance_retention_pct:null};
    expect(renderToStaticMarkup(<HolderHistoryValues data={zero}/>)).toContain("undefined with a zero baseline");
  });
  it("holds incomplete or oversized archives without inventing an empty population",()=>{
    const data=report();data.since_first={...data.since_first!,status:"held",entrants:null,exits:null,retained:null,net_change:null,gaps:["inventory_incomplete"]};
    expect(renderToStaticMarkup(<HolderHistoryValues data={data}/>)).toContain("Comparison held: inventory incomplete");
    data.status="limited";data.archive_records=97;data.snapshots=[];
    const html=renderToStaticMarkup(<HolderHistoryValues data={data}/>);expect(html).toContain("Comparisons are withheld");expect(html).not.toContain("No saved full owner inventories");
  });
  it("starts collapsed with no collection or wallet controls",()=>{
    const html=renderToStaticMarkup(<HolderHistory address={report().address}/>);expect(html).toContain("Holder growth &amp; retention");expect(html).not.toContain("open=");expect(html).not.toContain("<button");
  });
});

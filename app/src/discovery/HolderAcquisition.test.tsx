import{beforeAll,describe,expect,it}from"vitest";
import{renderToStaticMarkup}from"react-dom/server";
import{HolderAcquisition,HolderAcquisitionValues}from"./HolderAcquisition";
import{holderAcquisitionFixture}from"../../../discovery/src/holder-acquisition-fixtures.test-helper";
import{reviewHolderAcquisition}from"../../../discovery/src/holder-acquisition";
import type{HolderAcquisitionReport}from"../../../discovery/src/holder-acquisition-model";
let report:HolderAcquisitionReport;
beforeAll(async()=>{report=await reviewHolderAcquisition(await holderAcquisitionFixture());});
describe("sampled holder acquisition evidence",()=>{
  it("shows signed-buy support separately from meaningful growth and organic certification",()=>{
    const html=renderToStaticMarkup(<HolderAcquisitionValues data={report}/>);
    for(const value of["Meaningful holder growth remains unknown","1 with sample-consistent signed net buys","acquisition unknown","No scoring credit","not proof of independent buyers","canonical","Unmatched recipients are not labelled dust or scams"])expect(html.toLowerCase()).toContain(value.toLowerCase());
  });
  it("holds missing evidence rather than presenting it as zero purchases",()=>{
    const data=structuredClone(report);data.since_first={...data.since_first!,status:"held",supported_net_buy_entrants:null,acquisition_unknown_entrants:1};
    data.recent=null;data.wallet_observed_at=null;data.wallet_stale=true;
    const html=renderToStaticMarkup(<HolderAcquisitionValues data={data}/>);expect(html).toContain("Acquisition comparison held");expect(html).toContain("raw entrants remain unqualified");expect(html).not.toContain("0 with sample-consistent");
  });
  it("shows dated scope, stale inventories, exclusions and missing baselines",()=>{
    const data=structuredClone(report);data.history.stale=true;data.wallet_stale=true;
    const html=renderToStaticMarkup(<HolderAcquisitionValues data={data}/>);expect(html).toContain("historical observations");expect(html).toContain("stale or missing");expect(html).toContain("Exclusions and interval gaps");
    data.since_first=null;data.recent=null;expect(renderToStaticMarkup(<HolderAcquisitionValues data={data}/>)).toContain("Missing acquisition evidence is unknown, not zero buying");
  });
  it("starts collapsed without source refresh, wallet signing or purchase controls",()=>{
    const html=renderToStaticMarkup(<HolderAcquisition address={report.history.address}/>);expect(html).toContain("Holder acquisition checks");expect(html).not.toContain("open=");expect(html).not.toContain("<button");
  });
});

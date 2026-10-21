import {expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {RecentActivityCell} from "./RecentActivity";
import {assembleGmgnWindowData} from "../../../discovery/src/gmgn-window";
import {windowEntries,windowEnd,windowStart,windowAddress} from "../../../discovery/src/gmgn-window-fixtures.test-helper";
import {reviewRecentActivity,unavailableRecentActivity} from "../../../discovery/src/recent-activity";
const at=new Date(Date.parse(windowEnd)+60000);
it("shows exact recent and previous windows, units, coverage and limitations",async()=>{
  const report=await reviewRecentActivity(await assembleGmgnWindowData(windowEntries()),at),html=renderToStaticMarkup(<RecentActivityCell report={report} minutes={60}/>);
  for(const text of ["$720 reported","1.00× preceding 1h reported volume","60 / 60 closed minutes","Recent window &amp; coverage","Preceding period","trader breadth and organic demand are unknown","No score credit",report.parent_window_hash!])expect(html).toContain(text);
  expect(html).not.toContain("organic volume leaders");
});
it("distinguishes zero recent volume, missing baseline, incomplete coverage and stale reports",async()=>{
  const entries=windowEntries();for(const e of entries)for(const b of e.response.data.list)if(b.time>=Date.parse(windowStart)+300*60000){b.volume="0";b.amount="0";}
  const report=await reviewRecentActivity(await assembleGmgnWindowData(entries),new Date(at.getTime()+3600000));
  const zero=renderToStaticMarkup(<RecentActivityCell report={report} minutes={60}/>);expect(zero).toContain("$0.00 reported");expect(zero).toContain("0.00× preceding 1h");expect(zero).toContain("stale");
  const baseline=renderToStaticMarkup(<RecentActivityCell report={report} minutes={5}/>);expect(baseline).toContain("Previous-period volume ratio unknown");expect(baseline).not.toContain("Infinity");
  for(const e of entries)e.response.data.list=e.response.data.list.filter(b=>b.time!==Date.parse(windowEnd)-60000);
  const incomplete=await reviewRecentActivity(await assembleGmgnWindowData(entries),at),partial=renderToStaticMarkup(<RecentActivityCell report={incomplete} minutes={5}/>);expect(partial).toContain("Unknown volume");expect(partial).toContain("4 / 5 closed minutes · partial");expect(partial).not.toContain("$0 reported");
});
it("keeps missing, rejected, legacy and simulation reports explicit",async()=>{
  for(const state of ["missing","rejected","simulation"] as const){const report=await unavailableRecentActivity(windowAddress,at,state,"unavailable"),html=renderToStaticMarkup(<RecentActivityCell report={report} minutes={5}/>);expect(html).toContain("Unknown");expect(html).not.toContain("$0");if(state==="simulation")expect(html).toContain("Simulation");if(state==="rejected")expect(html).toContain("rejected");}
  expect(renderToStaticMarkup(<RecentActivityCell report={undefined} minutes={5}/>)).toContain("No saved candle window");
});

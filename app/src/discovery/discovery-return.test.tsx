import {expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {discoveryReturnTo,tokenDiscoveryReturn,tokenInspectHref} from "./discovery-return";
import {discoveryView,discoveryViewParams} from "./discovery-view";
import {DiscoveryReturnLink} from "./DiscoveryReturnLink";
import {DiscoveryTable} from "./DiscoveryWorkspace";
import {ShortlistPanel} from "./Shortlist";
import {fixtureCandidates} from "../../../discovery/src/fixtures";
import {candidateCard} from "../../../discovery/src/candidate-card";
import {assess,DEFAULT_POLICY} from "../../../discovery/src/model";

const mints=["CSocnzcRpgSCr1naKcNTieWZUxb6rABe45j844m7pump","ZyGXWijSJEgcCDb8CeSJ4Vj33iceATGoeKGidnfpump"];
const view=discoveryView(`?mode=fixture&q=token+%26+mint&layout=table&age=all&sort=liquidity&freshness=stale&status=excluded&min_liquidity=25000&min_coverage=35&compare=${mints}`);
const context=`/discover?${discoveryViewParams(view)}`;
it("preserves filters, comparison and layout through inspection, sharing and saved/comparison return sections",()=>{
  for(const section of [undefined,"saved-tokens","compare-tokens"] as const){
    const target=discoveryReturnTo(context,"fixture",section);
    const inspect=new URL(tokenInspectHref(mints[0]!,"fixture",target),"https://local.invalid");
    expect(inspect.pathname).toBe(`/token/solana/${mints[0]}`);expect(inspect.searchParams.get("mode")).toBe("fixture");
    const back=tokenDiscoveryReturn(inspect.search,"fixture");
    expect(back).toBe(target);expect(discoveryView(new URL(back,inspect).search)).toEqual(view);
    expect(back.endsWith(section?"#"+section:"compare="+encodeURIComponent(mints.join(",")))).toBe(true);
  }
});
it("binds navigation to the inspected mode, drops unknown parameters/cursors, and never accepts an arbitrary return destination",()=>{
  const fallback=discoveryReturnTo(null,"fixture");
  for(const bad of ["https://evil.example/discover","//evil.example/discover","/\\evil.example/discover","/discover\n?mode=live","/admin/10x","/api/10x/candidates","/%64iscover","/discover/../admin/10x","/discover?"+"q".repeat(4100)])expect(discoveryReturnTo(bad,"fixture")).toBe(fallback);
  const url=new URL(discoveryReturnTo(context+"&cursor=secret&GMGN_API_KEY=secret&returnTo=https://evil.example#admin","live"),"https://local.invalid");
  expect(url.pathname).toBe("/discover");expect(url.searchParams.get("mode")).toBe("live");expect(url.search).not.toContain("secret");expect(url.hash).toBe("");
  expect(discoveryView(url.search)).toEqual({...view,mode:"live"});
  expect(tokenInspectHref(mints[0]!,"live")).toBe(`/token/solana/${mints[0]}`);
});
it("bounds malformed filters and comparison selection while keeping encoded search text inert",()=>{
  const target=discoveryReturnTo('/discover?q=%3Cscript%3E%26%23&min_coverage=101&min_liquidity=-1&compare=../../keys&layout=evil',"live");
  expect(discoveryView(new URL(target,"https://local.invalid").search)).toMatchObject({q:"<script>&#",min_coverage:0,min_liquidity:0,compare:[],layout:"cards"});
  const html=renderToStaticMarkup(<DiscoveryReturnLink search={new URL(tokenInspectHref(mints[0]!,"live",target),"https://local.invalid").search} mode="live"/>);
  expect(html).toContain("Back to Discovery");expect(html).not.toContain("<script>");
});
it("passes workspace context through table and off-page saved links without persisting scores or changing identity",async()=>{
  const at=new Date("2026-10-22T01:00:00Z"),card=candidateCard(assess((await fixtureCandidates(at))[0]!,DEFAULT_POLICY,at));
  const table=renderToStaticMarkup(<DiscoveryTable candidates={[card]} artwork={{}} scoredAt={at.toISOString()} returnTo={context}/>);
  const savedReturn=discoveryReturnTo(context,"fixture","saved-tokens");
  const saved=renderToStaticMarkup(<ShortlistPanel state={{mode:"fixture",status:"saved",message:"",entries:[{chain:"solana",address:card.address,name:card.name,symbol:card.symbol,mode:"fixture",saved_at:at.toISOString()}]}} candidates={[]} selected={[]} onRemove={()=>{}} onClear={()=>{}} onCompare={()=>{}} returnTo={savedReturn}/>);
  expect(table).toContain(tokenInspectHref(card.address,"fixture",context).replaceAll("&","&amp;"));
  expect(saved).toContain(tokenInspectHref(card.address,"fixture",savedReturn).replaceAll("&","&amp;"));expect(saved).toContain("Outside current results");
});

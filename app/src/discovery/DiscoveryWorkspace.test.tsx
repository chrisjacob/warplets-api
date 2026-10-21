import {expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {discoveryView,discoveryViewParams,discoveryCandidatesUrl,DiscoveryTable,DiscoveryWorkspaceControls} from "./DiscoveryWorkspace";
import {fixtureCandidates} from "../../../discovery/src/fixtures";
import {assess,DEFAULT_POLICY} from "../../../discovery/src/model";
import {candidateCard} from "../../../discovery/src/candidate-card";

it("round-trips shared view parameters and separates presentation layout from the cache-only query",()=>{
  const view=discoveryView("?q=Kimchi&layout=table&age=all&sort=liquidity&min_liquidity=25000&min_coverage=30&freshness=stale&status=excluded");
  expect(discoveryView("?"+discoveryViewParams(view))).toEqual(view);
  const url=new URL(discoveryCandidatesUrl(view),"https://app-local.10x.meme");expect(url.searchParams.get("q")).toBe("Kimchi");expect(url.searchParams.has("layout")).toBe(false);expect(url.searchParams.get("limit")).toBe("100");expect(url.searchParams.get("browse")).toBe("inventory");expect(url.pathname).toBe("/api/10x/candidates");
  expect(discoveryView("?min_liquidity=-1&min_coverage=101&layout=evil&freshness=organic&mode=bad")).toMatchObject({min_liquidity:0,min_coverage:0,layout:"cards",freshness:"all",mode:"live"});
  expect(new URL(discoveryCandidatesUrl({...view,mode:"fixture",age:"24h"}),url).searchParams.get("age")).toBe("all");
});
it("provides accessible search/filter controls and preserves the v4 default with no organic sort",()=>{
  const html=renderToStaticMarkup(<DiscoveryWorkspaceControls view={discoveryView("")} onChange={()=>{}}/>);
  for(const text of ["Find a token","Name, symbol or exact mint","Compact table","Min. evidence coverage","Fresh · within 3 minutes","Discovery score · highest first"])expect(html).toContain(text);
  expect(html).not.toContain("Organic leaders");expect(html).toContain('type="search"');expect(html).toContain('maxLength="100"');
});
it("keeps token images, mint copying, provenance and unknown metrics visible in a table; null volume is not zero",async()=>{
  const at=new Date("2026-10-21T01:00:00.000Z"),base=(await fixtureCandidates(at))[0]!,card=candidateCard(assess({...base,market:{...base.market!,volume_24h_usd:null,image_url:"https://cdn.dexscreener.com/image.png"}},DEFAULT_POLICY,at));
  const html=renderToStaticMarkup(<DiscoveryTable candidates={[card]} artwork={{}} scoredAt={at.toISOString()}/>);
  for(const text of ["Reported 24h volume","Organic share unknown","Qualified holder growth and recent momentum are not yet available","Mint &amp; copy","Copy mint",card.address,"https://cdn.dexscreener.com/image.png","Unknown","Source / freshness"])expect(html).toContain(text);
  expect(html).not.toContain("$0");expect(html).toContain('tabindex="0"');expect(html).toContain('scope="col"');expect(html).toContain("mode=fixture");
});

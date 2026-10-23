import {expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {TokenImage,displayImageSources} from "./TokenArtwork";
import {artworkBatches} from "./token-artwork-client";
import {ShortlistPanel} from "./Shortlist";
import {createShortlistRepository} from "./shortlist-store";
import {fixtureCandidates} from "../../../discovery/src/fixtures";

it("keeps a named fixed-size loading shell until the browser confirms rendering",()=>{
  const html=renderToStaticMarkup(<TokenImage name="Example" symbol="EX" url="https://cdn.dexscreener.com/token.png"/>);
  expect(html).toContain('data-artwork-state="loading"');expect(html).toContain("Example: artwork loading");expect(html).toContain("Loading artwork…");
  expect(html).toContain('width="88"');expect(html).toContain('height="88"');expect(html).toContain('loading="lazy"');expect(html).toContain('referrerPolicy="no-referrer"');
  expect(html).not.toContain('data-artwork-state="loaded"');
});
it("rejects unsafe sources and keeps missing or pending artwork explicit",()=>{
  const missing=renderToStaticMarkup(<TokenImage name={'<script>bad</script>'} symbol="??" url="http://127.0.0.1/private.png" metadataUrl="data:image/png;base64,abc"/>);
  expect(missing).toContain('data-artwork-state="unavailable"');expect(missing).toContain("Image unavailable");expect(missing).not.toContain("<img");expect(missing).not.toContain("<script>");
  expect(renderToStaticMarkup(<TokenImage name="Pending" symbol="P" metadataLoading/>)).toContain('data-artwork-state="loading"');
});
it("keeps the original source and safe CDN fallback in order, resizing only the known display endpoint",()=>{
  const source="https://cdn.dexscreener.com/cms/images/abc_123?width=800&height=800&quality=95&format=auto",fallback="https://dd.dexscreener.com/ds-data/tokens/base/0x0000000000000000000000000000000000001234.png";
  expect(displayImageSources([source,fallback],64)).toEqual([source.replace("width=800&height=800","width=64&height=64"),fallback]);
  expect(displayImageSources([source,fallback])).toEqual([source,fallback]);
  expect(displayImageSources(["http://localhost/private",fallback,fallback],64)).toEqual([fallback]);
});
it("deduplicates the current page and full existing shortlist into unchanged 100-address endpoint batches",()=>{
  const addresses=Array.from({length:200},(_,i)=>`mint-${i}`),batches=artworkBatches([...addresses,...addresses.slice(0,100)]);
  expect(batches.map(b=>b.length)).toEqual([100,100]);expect(new Set(batches.flat()).size).toBe(200);expect(artworkBatches([])).toEqual([]);
  expect(()=>artworkBatches([...addresses,"extra"])).toThrow("artwork_view_size");
});
it("uses cached metadata artwork for saved tokens outside the current ranked page without inventing grades",async()=>{
  const c=(await fixtureCandidates(new Date("2026-10-22T01:00:00Z")))[0]!,repo=createShortlistRepository(()=>{throw Error("no browser storage");});
  const state=repo.change("live",{type:"save",token:{...c,mode:"live"}}),html=renderToStaticMarkup(<ShortlistPanel state={state} candidates={[]} artwork={{[c.address]:{image_url:"https://cdn.dexscreener.com/saved.png"}}} selected={[]} onRemove={()=>{}} onClear={()=>{}} onCompare={()=>{}}/>);
  expect(html).toContain('src="https://cdn.dexscreener.com/saved.png"');expect(html).toContain("Outside current results");expect(html).toContain(c.address);expect(html).not.toContain("100 / 100");
});

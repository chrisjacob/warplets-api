import { describe, it, expect, vi, afterEach } from "vitest";
import { localSpotlightPreview } from "./localSpotlightPreview";
import saved from "./shared/stonkletsNewsPreview.json";
import reviewed from "./shared/stonkletsNarrativeBackfill.json";
const cache=vi.hoisted(()=>({value:undefined as unknown}));
vi.mock("node:fs", () => ({ readFileSync: () => { if(cache.value) return JSON.stringify(cache.value);throw new Error("No local cache yet"); }, mkdirSync: vi.fn(), writeFileSync: vi.fn(), renameSync: vi.fn() }));
afterEach(() => {cache.value=undefined;vi.unstubAllGlobals();});
describe("local news cold start", () => {
  it("keeps reviewed narratives authoritative over stale persistent cache copies",async()=>{
    const item=reviewed.entries.find(i=>i.pairId==='direxion-soxs')!;
    cache.value=[{...item,headline:'Old unreviewed cached headline',sources:[{...item.sources[0],excerpt:'Stale unreviewed evidence'}]}];
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('Offline')));
    let handle:Function;const plugin=localSpotlightPreview();
    (plugin.configureServer as Function)({middlewares:{use(fn:Function){handle=fn;}}});
    const result=await new Promise<any>(resolve=>handle({url:'/api/stonklets/news?news='+item.id,method:'GET'},{setHeader(){},end(body:string){resolve(JSON.parse(body));}},()=>resolve(null)));
    expect(result.news.headline).toBe(item.headline);
    expect(result.news.sources[0].excerpt).toBe(item.sources[0]!.excerpt);
  });
  it("serves one saved story per stock and archived links through a market outage without redating them", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Market unavailable")));
    let handle: Function;
    const plugin = localSpotlightPreview();
    const configure = plugin.configureServer as Function;
    configure({ middlewares: { use(fn: Function) { handle = fn; } } });
    const request = (url: string) => new Promise<any>(resolve => handle({ url, method: "GET" }, { setHeader() {}, end(body: string) { resolve(JSON.parse(body)); } }, () => resolve(null)));
    const first = await request("/api/stonklets/spotlight");
    expect(first.entries).toHaveLength(10);
    expect(first.preview).toBe(true);
    const archived = await request(`/api/stonklets/spotlight?news=${saved[5]!.id}`);
    expect(archived.thesis.id).toBe(saved[5]!.id);
    expect(archived.thesis.selectedAt).toBe(saved[5]!.selectedAt);
    expect("quoteAt" in archived.thesis).toBe(false);
    expect(fetch).toHaveBeenCalled();
    expect((await request("/api/stonklets/spotlight")).entries).toHaveLength(10);
    expect(fetch).toHaveBeenCalled();
  });
});

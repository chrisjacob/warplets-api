import {afterEach,expect,it,vi} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {historyUrl,readHistoryPage,HistoryDirectoryRows} from "./HistoryDirectory";
import type {HistoryDirectory} from "../../../discovery/src/history-directory-model";
import {toBase58} from "../../../discovery/src/solana";

const mint=toBase58(new Uint8Array(32).fill(1));
const page:HistoryDirectory={version:"history-directory-v1",read_at:"2026-10-21T09:00:00.000Z",mode:"live",mint:null,
  rows:[{address:mint,name:"<script>alert(1)</script>",symbol:"TEST",checked_at:"2026-10-21T08:00:00.000Z",metadata_status:"available"}],total_retained:5000,next_cursor:null,
  scope:"retained_identity_directory",pagination:"live_keyset_not_snapshot",ordering:"address_ascii_ascending",ranked:false,provider_requests:0,database_writes:0};
afterEach(()=>vi.restoreAllMocks());
it("keeps exact mint, mode and cursor in the cached directory query",()=>{
  const url=new URL(historyUrl({mode:"fixture",mint},"opaque"),"http://localhost");expect(url.searchParams.get("mode")).toBe("fixture");expect(url.searchParams.get("mint")).toBe(mint);expect(url.searchParams.get("cursor")).toBe("opaque");expect(url.searchParams.get("limit")).toBe("100");
});
it("renders escaped identity hints and explicit metadata holds without an invented grade",()=>{
  const html=renderToStaticMarkup(<HistoryDirectoryRows report={page}/>);expect(html).toContain("&lt;script&gt;");expect(html).not.toContain("<script>");expect(html).toContain(`/token/solana/${mint}`);expect(html).toContain("not evidence freshness or a grade");
  const held=renderToStaticMarkup(<HistoryDirectoryRows report={{...page,mode:"fixture",rows:[{address:mint,name:null,symbol:null,checked_at:null,metadata_status:"held"}]}}/>);expect(held).toContain("Metadata unavailable");expect(held).toContain("mode=fixture");expect(held).not.toContain("Score");
});
it("bounds full response reads and checks mode/mint rather than displaying another scope",async()=>{
  const network=vi.spyOn(globalThis,"fetch").mockResolvedValue(Response.json(page));
  expect(await readHistoryPage({mode:"live",mint:""},null,new AbortController().signal)).toEqual(page);expect(network.mock.calls[0]![1]).toMatchObject({cache:"no-store"});
  network.mockResolvedValueOnce(Response.json({...page,mode:"fixture"}));await expect(readHistoryPage({mode:"live",mint:""},null,new AbortController().signal)).rejects.toThrow(/scope/);
  network.mockResolvedValueOnce(new Response(" ".repeat(256001)));await expect(readHistoryPage({mode:"live",mint:""},null,new AbortController().signal)).rejects.toThrow(/bound/);
});
it("rejects mixed directory order, false ranking and a continuation which does not match the last identity",async()=>{
  const network=vi.spyOn(globalThis,"fetch");
  for(const bad of [{...page,ranked:true},{...page,rows:[page.rows[0]!,page.rows[0]!]},{...page,next_cursor:btoa(JSON.stringify({version:"history-directory-v1",mode:"fixture",mint:null,after:mint}))}]){
    network.mockResolvedValueOnce(Response.json(bad));await expect(readHistoryPage({mode:"live",mint:""},null,new AbortController().signal)).rejects.toThrow();
  }
});

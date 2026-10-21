import {expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {MarketBatchCoverage} from "./MarketBatchCoverage";
import {freezeMarketBatch} from "../../../discovery/src/market-batch";
import {toBase58} from "../../../discovery/src/solana";
import {WSOL} from "../../../discovery/src/pump";
const key=(i:number)=>toBase58(new Uint8Array(32).fill(i));
async function summary(bad=false){const rows=[{address:key(31),pool:key(41)}],{record}=await freezeMarketBatch({version:"dex-market-input-v1",at:"2026-10-21T00:00:00.000Z",rows,pairs:[{chainId:"solana",pairAddress:rows[0]!.pool,baseToken:{address:rows[0]!.address},quoteToken:{address:bad?null:WSOL}}]});const {inputs,...result}=record;return result;}
it("keeps rejected targets, stale observations and limited diagnostic retention explicit",async()=>{
  const latest=await summary(true),html=renderToStaticMarkup(<MarketBatchCoverage data={{retention:"latest_response_and_latest_issue",latest,latest_issue:latest,provider_requests:0}} />);
  for(const text of ["0 / 1 requested pool quotes validated","1 rejected","quoteToken.address","Unassignable pair identities hold the whole batch","leave older observations unchanged","freshness and every other eligibility check still apply","not a complete market archive","no provider requests"])expect(html).toContain(text);
});
it("distinguishes a historical issue from the latest valid response",async()=>{
  const html=renderToStaticMarkup(<MarketBatchCoverage data={{retention:"latest_response_and_latest_issue",latest:await summary(),latest_issue:await summary(true),provider_requests:0}} />);
  expect(html).toContain("1 / 1 requested pool quotes validated");expect(html).toContain("Last recorded incomplete response");expect(html).toContain("historical issue is separate from the latest response");
});
it("does not imply a refresh before the first retained response",()=>{
  const html=renderToStaticMarkup(<MarketBatchCoverage data={{retention:"latest_response_and_latest_issue",latest:null,latest_issue:null,provider_requests:0}} />);
  expect(html).toContain("No DEX Screener batch has been retained yet");expect(html).toContain("normal schedule");
});

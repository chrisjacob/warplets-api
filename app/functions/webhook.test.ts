import {afterEach,describe,expect,it,vi} from "vitest";
import {createJsonFarcasterSignature,signedKeyRequestAbi} from "@farcaster/miniapp-node";
import * as AbiParameters from "ox/AbiParameters";
import {handleWebhookRequest} from "./webhook";

// Disposable test signing material. Every Hub response is local/mocked; no
// wallet, provider credential, live token or real database is used.
const signed=(payload:unknown)=>createJsonFarcasterSignature({fid:123,type:"app_key",privateKey:new Uint8Array(32).fill(11),payload:Buffer.from(JSON.stringify(payload))});
const details={url:"https://example.com/notify",token:"synthetic-notification-token"};
function setup(body:unknown,hub:"valid"|"absent"|"error"="valid"){
  const writes:{sql:string;values:unknown[]}[]=[];
  const db={prepare:(sql:string)=>({bind:(...values:unknown[])=>({run:async()=>{writes.push({sql,values});return {success:true};}})})};
  const fetch=vi.fn(async(input:string|URL|Request,init?:RequestInit)=>{
    const url=new URL(String(input));expect(url.origin+url.pathname).toBe("https://hub-api.neynar.com/v1/onChainSignersByFid");expect(url.searchParams.get("fid")).toBe("123");
    expect(new Headers(init?.headers).get("x-api-key")).toBe("test-only-key");if(hub==="error")throw Error("synthetic hub outage");
    const key=JSON.parse(Buffer.from((body as {header:string}).header,"base64url").toString("utf8")).key;
    const metadata=AbiParameters.encode(signedKeyRequestAbi,[{requestFid:9152n,requestSigner:"0x0000000000000000000000000000000000000001",signature:"0x",deadline:0n}]);
    return Response.json({events:hub==="absent"?[]:[{signerEventBody:{key,metadata:Buffer.from(metadata.slice(2),"hex").toString("base64")}}]});
  });vi.stubGlobal("fetch",fetch);
  const context={request:new Request("https://app.10x.meme/webhook/app",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}),
    env:{WARPLETS:db,NEYNAR_API_KEY:"test-only-key",APP_APP_FID:"9152"}} as unknown as Parameters<typeof handleWebhookRequest>[0];
  return {context,writes,fetch};
}
afterEach(()=>vi.unstubAllGlobals());

describe("actual SDK signed-webhook compatibility",()=>{
  it.each(["miniapp_added","notifications_enabled","miniapp_removed","notifications_disabled","frame_added","frame_removed"])("verifies and persists %s with unchanged app isolation",async event=>{
    const test=setup(signed({event,notificationDetails:details})),response=await handleWebhookRequest(test.context);
    expect(response.status).toBe(200);expect(await response.json()).toEqual({success:true});expect(test.fetch).toHaveBeenCalledTimes(1);
    const log=test.writes.find(w=>w.sql.includes("INSERT INTO notification_webhook_events"))!;expect(log.values.slice(0,3)).toEqual([123,9152,"app"]);
    const enabled=["miniapp_added","notifications_enabled","frame_added"].includes(event),token=test.writes.find(w=>w.sql.includes(enabled?"INSERT INTO miniapp_notification_tokens":"UPDATE miniapp_notification_tokens"))!;
    expect(token.values).toEqual(enabled?[123,9152,"app",details.url,details.token]:[123,"app"]);
  });
  it("rejects a forged signature before Hub verification or lifecycle writes",async()=>{
    const body=signed({event:"miniapp_removed"});body.signature=Buffer.alloc(64).toString("base64url");const test=setup(body),response=await handleWebhookRequest(test.context);
    expect(response.status).toBe(400);expect(test.fetch).not.toHaveBeenCalled();expect(test.writes).toEqual([]);
  });
  it.each(["absent","error"] as const)("holds lifecycle writes when the Hub result is %s",async hub=>{
    const test=setup(signed({event:"miniapp_removed"}),hub),response=await handleWebhookRequest(test.context);
    expect(response.status).toBe(hub==="absent"?401:500);expect(test.writes).toEqual([]);
  });
  it("rejects signed malformed events after verification without lifecycle writes",async()=>{
    const test=setup(signed({event:"notifications_enabled"})),response=await handleWebhookRequest(test.context);
    expect(response.status).toBe(400);expect(test.fetch).toHaveBeenCalledTimes(1);expect(test.writes).toEqual([]);
  });
});

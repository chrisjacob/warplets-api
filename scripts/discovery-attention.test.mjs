import{test}from"node:test";import assert from"node:assert/strict";
import{attentionOperatorRequest,collectAttentionOnTick}from"./discovery-attention.mjs";
test("attention operator exposes only local cached reads, two hourly sources and bounded same-chain market checks",()=>{
 assert.equal(attentionOperatorRequest(["read"]).method,"GET");assert.equal(attentionOperatorRequest(["collect","gmgn"]).body.source,"gmgn");
 assert.equal(attentionOperatorRequest(["crosscheck","base","0x0000000000000000000000000000000000001234"]).body.request.kind,"attention_dex_crosscheck");
 for(const args of[["collect","fomo"],["collect","gmgn","force"],["crosscheck","base","https://evil.test"],["crosscheck","unsupported","0x0000000000000000000000000000000000001234"]])assert.throws(()=>attentionOperatorRequest(args));
});
test("local attention tick calls each hourly admission once without retrying held/error responses",async()=>{
 const calls=[],signal=AbortSignal.timeout(1000),result=await collectAttentionOnTick("http://127.0.0.1:8794","synthetic-operator",signal,async(url,init)=>{calls.push({url,init});return calls.length===1?Response.json({state:"held",provider_requests:0,reason:"backoff"}):new Response(null,{status:429});});
 assert.equal(calls.length,2);assert.deepEqual(calls.map(c=>JSON.parse(c.init.body).source),["gmgn","geckoterminal"]);assert.equal(calls[0].init.redirect,"manual");assert.equal(result[0].provider_requests,0);assert.equal(result[1].http_status,429);
 await assert.rejects(()=>collectAttentionOnTick("https://evil.test","synthetic-operator",signal));
});

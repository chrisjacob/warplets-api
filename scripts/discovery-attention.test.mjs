import{test}from"node:test";import assert from"node:assert/strict";
import{attentionOperatorRequest,collectAttentionOnTick}from"./discovery-attention.mjs";
test("attention operator exposes only local cached reads, two hourly sources and bounded same-chain market checks",()=>{
 assert.equal(attentionOperatorRequest(["read"]).method,"GET");assert.equal(attentionOperatorRequest(["collect","gmgn"]).body.source,"gmgn");
 assert.equal(attentionOperatorRequest(["review"]).path,"admin/discovery/attention/review");assert.throws(()=>attentionOperatorRequest(["review","force"]));
 assert.equal(attentionOperatorRequest(["candles"]).path,"admin/discovery/attention/candles");assert.throws(()=>attentionOperatorRequest(["candles","base"]));
 assert.equal(attentionOperatorRequest(["traders"]).path,"admin/discovery/attention/traders");assert.throws(()=>attentionOperatorRequest(["traders","force"]));
 assert.equal(attentionOperatorRequest(["activity"]).path,"admin/discovery/attention/activity");assert.throws(()=>attentionOperatorRequest(["activity","wallet"]));
 assert.equal(attentionOperatorRequest(["crosscheck","base","0x0000000000000000000000000000000000001234"]).body.request.kind,"attention_dex_crosscheck");
 for(const args of[["collect","fomo"],["collect","gmgn","force"],["crosscheck","base","https://evil.test"],["crosscheck","unsupported","0x0000000000000000000000000000000000001234"]])assert.throws(()=>attentionOperatorRequest(args));
});
test("local attention tick calls each hourly admission once without retrying held/error responses",async()=>{
 const calls=[],signal=AbortSignal.timeout(1000),result=await collectAttentionOnTick("http://127.0.0.1:8794","synthetic-operator",signal,async(url,init)=>{calls.push({url,init});return calls.length===1?Response.json({state:"held",provider_requests:0,reason:"backoff"}):new Response(null,{status:429});});
 assert.equal(calls.length,6);assert.deepEqual(calls.slice(0,2).map(c=>JSON.parse(c.init.body).source),["gmgn","geckoterminal"]);assert(calls[2].url.endsWith("/attention/review"));assert(calls[3].url.endsWith("/attention/candles"));assert(calls[5].url.endsWith("/attention/activity"));assert(calls[4].url.endsWith("/attention/traders"));assert.equal(JSON.parse(calls[2].init.body).source,undefined);assert.equal(calls[0].init.redirect,"manual");assert.equal(result[0].provider_requests,0);assert.equal(result[1].http_status,429);
 await assert.rejects(()=>collectAttentionOnTick("https://evil.test","synthetic-operator",signal));
});

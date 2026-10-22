import { test } from "node:test";
import assert from "node:assert/strict";
import { startRelay } from "./discovery-relay.mjs";

test("loopback relay authenticates and forwards only whitelisted read methods", async () => {
  const calls = [], token = "test-local-operator-".repeat(4);
  const server = await startRelay({ token, rpcUrl: "https://api.mainnet-beta.solana.com", port: 0, transport: async (url, init) => { calls.push({ url, init }); return Response.json({ result: "read-only" }); } });
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${url}/rpc`, { method: "POST", body: "{}" })).status, 401);
    const options = { method: "POST", headers: { "x-tenx-local-relay": token }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getGenesisHash", params: [] }) };
    assert.equal((await fetch(`${url}/rpc`, options)).status, 200);
    assert.equal(calls[0].url, "https://api.mainnet-beta.solana.com/"); assert.equal(calls[0].init.redirect, "manual");
    for (const method of ["sendTransaction", "requestAirdrop", "simulateTransaction"]) {
      assert.equal((await fetch(`${url}/rpc`, { ...options, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method, params: [] }) })).status, 400);
    }
    assert.equal((await fetch(`${url}/https://evil.example`, { headers: { "x-tenx-local-relay": token } })).status, 404);
    assert.equal(calls.length, 1);
    assert.equal((await fetch(`${url}/market/pools/So11111111111111111111111111111111111111112`, { headers: { "x-tenx-local-relay": token } })).status, 200);
    assert.equal(calls[1].url, "https://api.geckoterminal.com/api/v2/networks/solana/pools/So11111111111111111111111111111111111111112?include=base_token");
    assert.equal((await fetch(`${url}/dex/tokens/So11111111111111111111111111111111111111112`, { headers: { "x-tenx-local-relay": token } })).status, 200);
    assert.equal(calls[2].url, "https://api.dexscreener.com/tokens/v1/solana/So11111111111111111111111111111111111111112");
    assert.equal((await fetch(`${url}/rpc`, { ...options, body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "getProgramAccounts", params: ["arbitrary", {}] }) })).status, 400);
    assert.equal((await fetch(`${url}/rpc`, { ...options, body: "x".repeat(33_000) })).status, 413);
    const cid = "QmVqaEuPxZ6wNcuCHyg7RA824LrWvhrbEQGn6Vb5yATJx2";
    assert.equal((await fetch(`${url}/metadata/ipfs/${cid}`, { headers: { "x-tenx-local-relay": token } })).status, 200);
    assert.equal(calls[3].url, `https://gateway.pinata.cloud/ipfs/${cid}`);
    assert.equal(calls[3].init.redirect, "manual");
    for (const path of ["/metadata/https://localhost/secret", `/metadata/ipfs/${cid}?url=https://evil.example`, `/metadata/ipfs/${cid}/%2e%2e/private`]) assert.equal((await fetch(`${url}${path}`, { headers: { "x-tenx-local-relay": token } })).status, 404);
    assert.equal(calls.length, 4);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test("finalized block-time reads accept only a single safe slot and cannot send transactions",async()=>{
  const token="read-block-time-".repeat(4),calls=[];
  const server=await startRelay({token,rpcUrl:"https://api.mainnet-beta.solana.com",port:0,transport:async(_url,init)=>{calls.push(JSON.parse(init.body));return Response.json({result:1234567890});}});
  const url=`http://127.0.0.1:${server.address().port}/rpc`;
  const request=(method,params)=>fetch(url,{method:"POST",headers:{"x-tenx-local-relay":token},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});
  try{
    assert.equal((await request("getBlockTime",[30000])).status,200);
    for(const params of [[],[-1],[1.5],[Number.MAX_SAFE_INTEGER+1],[30000,40000],["30000"]])assert.equal((await request("getBlockTime",params)).status,400);
    assert.equal((await request("sendTransaction",["payload"])).status,400);assert.equal(calls.length,1);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test("trending list relay fixes host, pagination and duration and requires local authorization", async () => {
  const token = "shortlist-local-".repeat(4), calls = [];
  const server = await startRelay({ token, rpcUrl: "https://api.mainnet-beta.solana.com", port: 0, transport: async (url) => { calls.push(url); return Response.json({ data: [] }); } });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/market/trending/24h/1`)).status, 401);
    assert.equal((await fetch(`${base}/market/trending/24h/1`, { headers: { "x-tenx-local-relay": token } })).status, 200);
    assert.equal(calls[0], "https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?duration=24h&page=1&include=base_token");
    for (const path of ["/market/trending/1s/1", "/market/trending/24h/3", "/market/trending/24h/1?url=https://evil.example"]) assert.equal((await fetch(base + path, { headers: { "x-tenx-local-relay": token } })).status, 404);
    assert.equal(calls.length, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test("global trending and cross-chain market reads stay on fixed hosts and validate contract format",async()=>{
 const token="global-attention-".repeat(4),calls=[],server=await startRelay({token,rpcUrl:"https://api.mainnet-beta.solana.com",port:0,transport:async(url)=>{calls.push(url);return Response.json({data:[]});}});
 const base=`http://127.0.0.1:${server.address().port}`,headers={"x-tenx-local-relay":token};
 try{assert.equal((await fetch(base+"/market/trending/global/24h/1",{headers})).status,200);assert.equal(calls[0],"https://api.geckoterminal.com/api/v2/networks/trending_pools?duration=24h&page=1&include=base_token,network");
 const mint="0x0000000000000000000000000000000000001234";assert.equal((await fetch(base+`/dex/attention/base/${mint}`,{headers})).status,200);assert.equal(calls[1],`https://api.dexscreener.com/tokens/v1/base/${mint}`);
 assert.equal((await fetch(base+"/dex/attention/base/So11111111111111111111111111111111111111112",{headers})).status,400);assert.equal((await fetch(base+"/market/trending/global/24h/1?url=https://evil.test",{headers})).status,404);assert.equal(calls.length,2);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test("RPC starts are spaced across concurrent requests and a provider 429 is shared",async()=>{
  const token="test-shared-rate-".repeat(4),starts=[];let limited=false;
  const server=await startRelay({token,rpcUrl:"https://api.mainnet-beta.solana.com",port:0,transport:async()=>{starts.push(Date.now());return limited?new Response(null,{status:429,headers:{"retry-after":"1200"}}):Response.json({result:"ok"})}});
  const url=`http://127.0.0.1:${server.address().port}/rpc`,options={method:"POST",headers:{"x-tenx-local-relay":token},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"getGenesisHash",params:[]})};
  try{const results=await Promise.all([fetch(url,options),fetch(url,options),fetch(url,options)]);assert.ok(results.every(r=>r.ok));assert.ok(starts[1]-starts[0]>=900);assert.ok(starts[2]-starts[1]>=900);limited=true;assert.equal((await fetch(url,options)).status,429);assert.equal((await fetch(url,options)).status,429);assert.equal(starts.length,4);}finally{await new Promise(resolve=>server.close(resolve))}
});

import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import test from "node:test";

// Follow the actual installed path, never a second test-only SDK/parser copy.
const appRequire=createRequire(new URL("../app/package.json",import.meta.url));
const nodeRequire=createRequire(appRequire.resolve("@farcaster/miniapp-node"));
const coreRequire=createRequire(nodeRequire.resolve("@farcaster/miniapp-core"));
const web3Path=coreRequire.resolve("@solana/web3.js"),web3Require=createRequire(web3Path);
const {Connection,PublicKey}=coreRequire("@solana/web3.js"),Client=web3Require("jayson/lib/client/browser");
const address=new PublicKey(new Uint8Array(32).fill(7));
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function connection(reply){const requests=[];return {requests,client:new Connection("https://rpc.invalid",{commitment:"finalized",disableRetryOnRateLimit:true,
  fetch:async(url,init)=>{assert.equal(String(url),"https://rpc.invalid");const request=JSON.parse(init.body);requests.push(request);return new Response(typeof reply==="string"?reply:JSON.stringify(reply(request)),{headers:{"content-type":"application/json"}});}})};}

test("the pinned Solana parent uses maintained Jayson without stream-json or uuid",()=>{
  const pkg=web3Require("jayson/package.json");assert.equal(pkg.version,"5.0.0");assert.equal(pkg.dependencies["stream-json"],undefined);assert.equal(pkg.dependencies.uuid,undefined);
});
test("real Solana HTTP client preserves finalized requests, secure IDs and result parsing",async()=>{
  const {client,requests}=connection(r=>({jsonrpc:"2.0",id:r.id,result:{context:{slot:99},value:12345}}));
  assert.equal(await client.getBalance(address),12345);assert.equal(await client.getBalance(address),12345);
  assert.deepEqual(requests[0].params,[address.toBase58(),{commitment:"finalized"}]);assert.equal(requests[0].method,"getBalance");
  assert.match(requests[0].id,uuid);assert.match(requests[1].id,uuid);assert.notEqual(requests[0].id,requests[1].id);
});
test("real Solana account-list decoding preserves missing accounts and RPC errors",async()=>{
  const good=connection(r=>({jsonrpc:"2.0",id:r.id,result:{context:{slot:99},value:[null]}}));assert.deepEqual(await good.client.getMultipleAccountsInfo([address]),[null]);
  const bad=connection(r=>({jsonrpc:"2.0",id:r.id,error:{code:-32000,message:"synthetic upstream failure"}}));await assert.rejects(bad.client.getBalance(address),/synthetic upstream failure/);
  await assert.rejects(connection("{broken").client.getBalance(address));
  await assert.rejects(connection(r=>({jsonrpc:"2.0",id:r.id,result:{context:{slot:99},value:"invalid"}})).client.getBalance(address));
});
test("browser-client batch/callback and explicit notification contracts remain intact",async()=>{
  const client=new Client((message,callback)=>{const rows=JSON.parse(message);callback(null,JSON.stringify(rows.map(r=>({jsonrpc:"2.0",id:r.id,result:r.params[0]}))));});
  const rows=[client.request("one",[1],"a"),client.request("two",[2],"b")];
  const replies=await new Promise((resolve,reject)=>client.request(rows,(error,result)=>error?reject(error):resolve(result)));
  assert.deepEqual(replies.map(r=>r.result),[1,2]);assert.equal(client.request("notify",[],null).id,undefined);
});
test("browser JSON handling preserves __proto__ as data without changing the result prototype",async()=>{
  const client=new Client((_message,callback)=>callback(null,'{"jsonrpc":"2.0","id":"a","result":{"__proto__":{"inherited":true},"constructor":"data"}}'));
  const response=await new Promise((resolve,reject)=>client.request("probe",[],"a",(error,value)=>error?reject(error):resolve(value)));
  assert.equal(Object.getPrototypeOf(response.result),Object.prototype);assert.equal(response.result.inherited,undefined);
  assert.equal(Object.hasOwn(response.result,"__proto__"),true);assert.deepEqual(response.result.__proto__,{inherited:true});assert.equal(response.result.constructor,"data");
});
test("replacement ID generator supports Web Crypto fallback and fails without secure randomness",()=>{
  const source=readFileSync(web3Require.resolve("jayson/lib/generateId"),"utf8");
  const load=crypto=>{const context={module:{exports:{}},crypto};runInNewContext(source,context);return context.module.exports;};
  assert.equal(load({randomUUID:()=>"secure-test-id"})(),"secure-test-id");
  assert.match(load({getRandomValues:bytes=>bytes.fill(7)})(),uuid);
  assert.throws(()=>load(undefined)(),/crypto.*unavailable/);
});

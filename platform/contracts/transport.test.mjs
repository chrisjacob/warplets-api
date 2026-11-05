import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../storage/database.mjs';
import {createApp} from '../server/application.mjs';
import {createClient,PlatformApiError} from './client.mjs';
test('typed client reads the negotiated envelope and keeps error correlation and cache scope',async t=>{
 const db=openDatabase();t.after(()=>db.close());
 const app=createApp(db),baseUrl='http://localhost/api/v1';
 const client=createClient({baseUrl,fetchImpl:(url,init)=>app(new Request(url,init))});
 const terms=await client.getPolicy();
 assert.equal(terms.data.version,terms.meta.policyVersion);assert.ok(terms.meta.requestId);
 const page=await client.listMarkets();assert.ok(Array.isArray(page.items));assert.ok(page.snapshotId);
 await assert.rejects(client.getMarket({path:{id:'..'}}),/unsafe path/);
 await assert.rejects(client.getProfile(),error=>error instanceof PlatformApiError&&error.status===401&&!!error.requestId);
 const r=await app(new Request(baseUrl+'/policy'));const etag=r.headers.get('etag');assert.ok(etag);
 assert.equal((await app(new Request(baseUrl+'/policy',{headers:{'if-none-match':etag}}))).status,304);
 const privateResponse=await app(new Request(baseUrl+'/me'));
 assert.equal(privateResponse.headers.get('cache-control'),'no-store');assert.equal(privateResponse.headers.get('etag'),null);
});

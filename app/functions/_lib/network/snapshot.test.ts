import {describe,it,expect} from 'vitest';
import {encodeNetworkSnapshot,decodeNetworkSnapshot,SNAPSHOT_STORAGE_BYTES} from './snapshot';
import {buildNetworkDashboard} from './aggregate';
import {parseNetworkFilters,type NetworkCell,type NetworkSnapshot} from '../../../shared/network/model';
function sample(cells:NetworkCell[]):NetworkSnapshot {
 return {id:'1792400000000-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',createdAt:1792400000000,cohort:'acceptance-signers',chain:'Base',scan:{fromBlock:1,throughBlock:2,targetBlock:2,complete:true},population:cells.reduce((n,c)=>n+c.count,0),profilesObserved:cells.reduce((n,c)=>n+c.count,0),profileOldestAt:1792400000000,cells,tokens:[],adoption:[]};
}
const cell:NetworkCell={country:'AU',state:'AU.02',city:'gn:123',location:'known',token:null,tokenStatus:'none',vote:'opted_in',acceptedDay:'2026-10-17',count:1,held:'eip155:8453/slip44:60',walletUsdUnits:'123456789123456789',portfolioValues:['123456789123456789'],activityMonths:['2026-10'],warpletHolder:true};
describe('Network snapshot storage',()=>{
 it('round-trips compressed cells losslessly and preserves filtered dashboard results',async()=>{
  const original=sample([cell,{...cell,country:null,state:null,city:null,location:'unknown',warpletHolder:false,walletUsdUnits:'0',portfolioValues:['0'],activityMonths:[]}]);
  const payload=await encodeNetworkSnapshot(original),restored=await decodeNetworkSnapshot(payload);
  expect(restored).toEqual(original);
  for(const q of ['', 'country=AU','warplet=holders','location=unknown','held=eip155:8453/slip44:60'])expect(buildNetworkDashboard(restored,parseNetworkFilters(new URLSearchParams(q)))).toEqual(buildNetworkDashboard(original,parseNetworkFilters(new URLSearchParams(q))));
  expect(JSON.parse(payload).scan).toEqual(original.scan);
  expect(JSON.parse(payload).cells).toBeUndefined();
 });
 it('continues reading existing plain JSON historical snapshots',async()=>{
  const original=sample([cell]);expect(await decodeNetworkSnapshot(JSON.stringify(original))).toEqual(original);
 });
 it('fits a full 50,000-account valuation cohort below the unchanged row budget',async()=>{
  const cells=Array.from({length:50000},(_,n)=>({...cell,country:n%2?'AU':'US',walletUsdUnits:String(BigInt(n+1)*100000003n),portfolioValues:[String(BigInt(n+1)*100000003n)],warpletHolder:n%3===0}));
  const original=sample(cells);expect(new TextEncoder().encode(JSON.stringify(original)).byteLength).toBeGreaterThan(SNAPSHOT_STORAGE_BYTES);
  const payload=await encodeNetworkSnapshot(original);expect(new TextEncoder().encode(payload).byteLength).toBeLessThan(SNAPSHOT_STORAGE_BYTES);
  expect(await decodeNetworkSnapshot(payload)).toEqual(original);
 },15000);
 it('rejects unsupported encodings and corrupt compressed data',async()=>{
  await expect(decodeNetworkSnapshot(JSON.stringify({...sample([]),cellsEncoding:'unknown',cellsGzip:'x'}))).rejects.toThrow('Unsupported snapshot encoding');
  await expect(decodeNetworkSnapshot(JSON.stringify({...sample([]),cellsEncoding:'gzip-json-v1',cellsGzip:btoa('invalid')}))).rejects.toThrow();
 });
 it('bounds decompressed data before parsing it',async()=>{
  const bytes=new Uint8Array(await new Response(new Response(' '.repeat(16000001)).body!.pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  const parts:string[]=[];for(let n=0;n<bytes.length;n+=32768)parts.push(String.fromCharCode(...bytes.subarray(n,n+32768)));
  await expect(decodeNetworkSnapshot(JSON.stringify({...sample([]),cellsEncoding:'gzip-json-v1',cellsGzip:btoa(parts.join(''))}))).rejects.toThrow('decode budget');
 });
});

import {describe,expect,it} from "vitest";
import {storedJsonHash,storedJsonTextHash} from "./stored-json-hash";
import {hashJson} from "./solana";

describe("bounded stored JSON SHA-256 verification",()=>{
  it("matches Web Crypto on primitive roots, JSON omissions, Unicode, escapes and canonical property order",async()=>{
    const values:unknown[]=[undefined,()=>1,Symbol("root"),null,true,false,0,-0,1.25,NaN,Infinity,"", "abc","\u0000\n\r\t\"\\","🙂漢字","\ud800","\udfff",
      [],[undefined,NaN,Symbol("array")],{a:undefined,b:NaN,c:Symbol("object"),d:1},{z:1,a:2},{a:2,z:1},new Date("2026-10-22T00:00:00.000Z"),new Uint8Array([0,255]),{toJSON:()=>({special:"value"})}];
    for(const value of values)expect(storedJsonHash(value)).toBe(await hashJson(value));
    expect(storedJsonHash(undefined)).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(storedJsonHash({z:1,a:2})).not.toBe(storedJsonHash({a:2,z:1}));
  });
  it("matches the original writer on large payloads and generated nested JSON without normalization",async()=>{
    let state=123456;
    const next=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state;};
    for(let i=0;i<256;i++){
      const value={sequence:i,items:Array.from({length:next()%32},()=>({raw:next(),text:String.fromCodePoint(next()%0x110000),missing:undefined,values:[null,!!(next()%2),next()/0xffffffff]}))};
      expect(storedJsonHash(value)).toBe(await hashJson(value));
    }
    for(const length of [16000,100000,600000,1800000])expect(storedJsonHash({payload:"x".repeat(length)})).toBe(await hashJson({payload:"x".repeat(length)}));
  });
  it("preserves serialization failures and never substitutes a passing digest",async()=>{
    const circular:any={};circular.self=circular;
    for(const value of [1n,circular,{toJSON(){throw Error("serialization_failure");}}]){
      expect(()=>storedJsonHash(value)).toThrow();await expect(hashJson(value)).rejects.toThrow();
    }
  });
  it("hashes already serialized bounded JSON as original UTF-8 bytes without wrapping or re-encoding values",async()=>{
    for(const value of [{z:1,a:"\u0000漢🙂\ud800"},[true,null,-0],{payload:"x".repeat(100000)}]){
      const text=JSON.stringify(value);expect(storedJsonTextHash(text)).toBe(await hashJson(value));expect(storedJsonTextHash(text)).not.toBe(storedJsonHash(text));
    }
  });
});

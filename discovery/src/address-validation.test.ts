import {describe,expect,it} from "vitest";
import {Address} from "./model";
import {fromBase58,publicKey,toBase58,validAddress} from "./solana";

const decoded=(value:string)=>{try {publicKey(value);return true;}catch{return false;}};
const alphabet="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
describe("exact 32-byte base58 address predicate",()=>{
  it("agrees with the unchanged decoder at every leading-zero byte width and inclusive boundary",()=>{
    for(let zeros=0;zeros<32;zeros++){
      const width=32-zeros,min=new Uint8Array(width);min[0]=1;
      const max=new Uint8Array(width).fill(255),lower=new Uint8Array(width-1).fill(255);
      const upper=new Uint8Array(width+1);upper[0]=1;
      for(const [bytes,accepted] of [[min,true],[max,true],[lower,false],[upper,false]] as const){
        const value="1".repeat(zeros)+toBase58(bytes);
        expect(validAddress(value),`${zeros} zero bytes / ${accepted}`).toBe(decoded(value));
        expect(validAddress(value)).toBe(accepted);
      }
    }
    for(let n=0;n<70;n++)expect(validAddress("1".repeat(n))).toBe(n===32);
  });
  it("agrees on deterministic generated keys, short/long values and address mutations",()=>{
    let state=0x6d2b79f5;
    const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};
    for(let i=0;i<4096;i++){
      const length=i%65,bytes=Uint8Array.from({length},()=>next()&255);
      if(i%3===0)bytes.fill(0,0,Math.min(length,i%33));
      const value=toBase58(bytes);
      for(const variant of [value,"1"+value,value+alphabet[next()%58],value.slice(1),value.slice(0,-1)]){
        expect(validAddress(variant)).toBe(decoded(variant));
        expect(Address.safeParse(variant).success).toBe(decoded(variant));
      }
    }
  });
  it("rejects every non-alphabet ASCII character in every position, including terminal newline",()=>{
    const address=toBase58(new Uint8Array(32).fill(255));
    for(let code=0;code<128;code++)if(!alphabet.includes(String.fromCharCode(code))){
      for(let i=0;i<=address.length;i++){
        const c=String.fromCharCode(code),variants=[address.slice(0,i)+c+address.slice(i),address.slice(0,i)+c+address.slice(i+1)];
        for(const value of variants){expect(validAddress(value)).toBe(false);expect(decoded(value)).toBe(false);}
      }
    }
    for(const suffix of ["\n","\r","\r\n","\u2028","\u2029","\u200b","🙂","１"]){
      expect(validAddress(address.slice(0,-1)+suffix)).toBe(false);expect(validAddress(suffix+address)).toBe(false);
    }
  });
  it("preserves decoding bytes, canonical key distinctions and the existing non-string fallback",()=>{
    const zero="1".repeat(32),high=toBase58(new Uint8Array(32).fill(255));
    expect(validAddress(zero)).toBe(true);expect(publicKey(zero)).toEqual(new Uint8Array(32));
    expect(validAddress(high)).toBe(true);expect(fromBase58(high,32)).toEqual(new Uint8Array(32).fill(255));
    for(const value of [null,undefined,7,{},[],new String(high),[...high]] as unknown as string[])expect(validAddress(value)).toBe(decoded(value));
    // Membership is a 32-byte encoding check, never a curve/signature or safety check.
    expect(Address.safeParse(zero).success).toBe(true);expect(Address.safeParse(high).success).toBe(true);
  });
});

import {EarnError} from './validation.mjs';
const fail=()=>{throw new EarnError(400,'unsupported_post_url','Use a shared Farcaster or X post link. Profiles, feeds and other websites are not supported.');};
const hosts=new Map([['x.com','x'],['www.x.com','x'],['twitter.com','x'],['www.twitter.com','x'],['mobile.twitter.com','x'],['farcaster.xyz','farcaster'],['www.farcaster.xyz','farcaster'],['warpcast.com','farcaster'],['www.warpcast.com','farcaster']]);
const shareKeys=new Set(['s','t','shareType','ref','ref_src','ref_url','utm_source','utm_medium','utm_campaign']);
/** Parse post identity only. A recognized host does not establish authorship,
 * content quality, safety, availability, or permission to score its contents. */
export function supportedPost(value){
 if(typeof value!=='string'||!value.length||value.length>2048||/[\u0000-\u0020\u007f\\]/.test(value))fail();
 let u;try{u=new URL(value);}catch{fail();}
 const source=hosts.get(u.hostname);if(u.protocol!=='https:'||u.username||u.password||u.port||!source||u.pathname.includes('%')||/\/(?:\.|\.\.)\//.test(value)||[...u.searchParams.keys()].some(key=>!shareKeys.has(key)))fail();
 if(source==='x'){
  const match=/^\/(?:[A-Za-z0-9_]{1,15}|i\/web|i)\/status\/([1-9][0-9]{0,19})(?:\/(?:photo\/[1-4]|video\/1))?\/?$/.exec(u.pathname);
  if(!match||BigInt(match[1])>18446744073709551615n)fail();return Object.freeze({source,id:match[1],username:null,canonicalUrl:'https://x.com/i/status/'+match[1]});
 }
 const match=/^\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})\/(0x(?:[a-fA-F0-9]{8}|[a-fA-F0-9]{40}))\/?$/.exec(u.pathname);if(!match)fail();
 return Object.freeze({source,id:match[2].toLowerCase(),username:match[1].toLowerCase(),canonicalUrl:'https://farcaster.xyz/'+match[1].toLowerCase()+'/'+match[2].toLowerCase()});
}

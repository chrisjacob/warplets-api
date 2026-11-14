import {useState,type ReactNode} from 'react';
import {useQuery} from '@tanstack/react-query';
import {z} from 'zod';
import './qa-identity.css';

const image=z.string().regex(/^\/qa-media\/[a-f0-9]{64}\.(png|jpg|webp|gif)$/).nullable();
const model=z.object({format:z.literal('10x.qa.public-identities.v1'),scope:z.literal('synthetic-presentation-only'),capturedAt:z.iso.datetime(),notice:z.string().max(512),
 profiles:z.array(z.object({wallet:z.string().max(128),username:z.string().regex(/^[a-zA-Z0-9._-]{1,64}$/),displayName:z.string().max(160),profileUrl:z.string().regex(/^https:\/\/farcaster\.xyz\/[a-zA-Z0-9._-]+$/),image})).max(1000),
 tokens:z.array(z.object({tokenId:z.string().max(128),originalSymbol:z.string().max(160),name:z.string().max(160),symbol:z.string().max(40),sourceUrl:z.string().regex(/^https:\/\/www\.geckoterminal\.com\/solana\/pools\/\w{32,44}$/),image})).max(1000)});
function useIdentityOverlay(){
 const enabled=typeof document!=='undefined'&&document.querySelector('meta[name="tenx-qa-public-identities"]')?.getAttribute('content')==='enabled';
 const query=useQuery({queryKey:['public','qa-identity-overlay'],enabled,retry:false,staleTime:Infinity,refetchOnWindowFocus:false,queryFn:async({signal})=>{
  const response=await fetch('/api/v1/qa/identities',{signal,credentials:'omit'});if(!response.ok)throw Error('QA identities unavailable.');
  const body=await response.text();if(body.length>524288)throw Error('QA identity bound.');return model.parse(JSON.parse(body));
 }});return enabled?query.data:undefined;
}
const tokenFor=(data:ReturnType<typeof useIdentityOverlay>,id:string)=>data?.tokens.find(token=>token.tokenId===id||token.originalSymbol===id);
export const useQaTokenPresentation=(id:string)=>tokenFor(useIdentityOverlay(),id);
export function QaIdentityArt({name,fallback}:{name:string;fallback:ReactNode}){
 const data=useIdentityOverlay(),[failed,setFailed]=useState<string|null>(null),source=tokenFor(data,name)?.image??data?.profiles.find(profile=>profile.wallet===name)?.image;
 return source&&source!==failed?<span className="token-art qa-public-art" aria-hidden="true"><img src={source} alt="" width="48" height="48" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>setFailed(source)}/></span>:<>{fallback}</>;
}
export function QaTokenName({id,fallback,compact=false}:{id:string;fallback:ReactNode;compact?:boolean}){
 const token=tokenFor(useIdentityOverlay(),id);return token?<span className="qa-public-name">{compact?token.symbol:token.name}<small>{compact?'demo':token.symbol+' · demo'}</small></span>:<>{fallback}</>;
}
export function QaParticipantName({wallet,fallback,full=false}:{wallet:string|null;fallback:ReactNode;full?:boolean}){
 const profile=useIdentityOverlay()?.profiles.find(profile=>profile.wallet===wallet);return profile?<span className="qa-public-name">{full?profile.displayName:'@'+profile.username}<small>{full?'@'+profile.username+' · demo':'demo'}</small></span>:<>{fallback}</>;
}
export function QaIdentityDetails({wallet}:{wallet:string}){
 const data=useIdentityOverlay(),profile=data?.profiles.find(profile=>profile.wallet===wallet);return profile?<p className="qa-public-attribution">Public profile artwork: <a href={profile.profileUrl} target="_blank" rel="noreferrer noopener">@{profile.username}</a>. This demo wallet and its activity are simulated. No affiliation.</p>:null;
}
export function QaTokenDetails({id}:{id:string}){
 const data=useIdentityOverlay(),token=tokenFor(data,id);return token?<div className="qa-public-attribution"><h3>{token.name} <small>{token.symbol} · demo</small></h3><p>Simulated Attention Token using public artwork from <a href={token.sourceUrl} target="_blank" rel="noreferrer noopener">GeckoTerminal trending pools</a>, captured {data!.capturedAt.slice(0,10)}. Prices and rewards remain demo data.</p></div>:null;
}

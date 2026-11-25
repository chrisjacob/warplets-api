import {presentationName} from './presentation-name';
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
 const data=useIdentityOverlay(),[failed,setFailed]=useState<string|null>(null),source=data?.profiles.find(profile=>profile.wallet===name)?.image;
 return source&&source!==failed?<span className="token-art qa-public-art" aria-hidden="true"><img src={source} alt="" width="48" height="48" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>setFailed(source)}/></span>:<>{typeof fallback==='string'?presentationName(fallback):fallback}</>;
}
export function QaTokenName({fallback}:{id:string;fallback:ReactNode;compact?:boolean}){
 // Reference artwork must never replace an Attention Token’s recorded ticker.
 return <>{typeof fallback==='string'?presentationName(fallback):fallback}</>;
}
export function QaParticipantName({wallet,fallback,full=false}:{wallet:string|null;fallback:ReactNode;full?:boolean}){
 const profile=useIdentityOverlay()?.profiles.find(profile=>profile.wallet===wallet);return profile?<span className="qa-public-name">{full?profile.displayName:'@'+profile.username}{full&&<small>@{profile.username}</small>}</span>:<>{typeof fallback==='string'?presentationName(fallback):fallback}</>;
}
export function QaIdentityDetails({wallet}:{wallet:string}){
 const data=useIdentityOverlay(),profile=data?.profiles.find(profile=>profile.wallet===wallet);return profile?<p className="qa-public-attribution">Public profile artwork: <a href={profile.profileUrl} target="_blank" rel="noreferrer noopener">@{profile.username}</a>.</p>:null;
}
export function QaTokenDetails({id}:{id:string}){
 const data=useIdentityOverlay(),token=tokenFor(data,id);return token?<div className="qa-public-attribution"><h3>Selected meme reference: {token.name} <small>{token.symbol}</small></h3><p>This reference artwork is not the Attention Token identity or evidence of affiliation. Artwork from <a href={token.sourceUrl} target="_blank" rel="noreferrer noopener">GeckoTerminal trending pools</a>, captured {data!.capturedAt.slice(0,10)}.</p></div>:null;
}

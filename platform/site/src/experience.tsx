import {createContext,useContext,useState,type ReactNode} from 'react';
import {QaIdentityArt} from './qa-identity';
const Experience=createContext({technical:false,toggle:()=>{}});
export function ExperienceProvider({children,initialTechnical=false}:{children:ReactNode;initialTechnical?:boolean}){
 const [technical,setTechnical]=useState(()=>{try{return sessionStorage.getItem('10x:technical')==='true'||initialTechnical;}catch{return initialTechnical;}});
 return <Experience.Provider value={{technical,toggle:()=>setTechnical(value=>{try{sessionStorage.setItem('10x:technical',String(!value));}catch{}return !value;})}}>{children}</Experience.Provider>;
}
export const useExperience=()=>useContext(Experience);
export function Diagnostics({children}:{children:ReactNode}){return useExperience().technical?<>{children}</>:null;}
export function TechnicalToggle(){const {technical,toggle}=useExperience();return <button className="technical-toggle" aria-pressed={technical} onClick={toggle}>{technical?'Switch to simple view':'Technical view'}</button>;}
export function TokenArt({name}:{name:string}){
 const n=[...name].reduce((a,c)=>a+c.charCodeAt(0),0)%3;
 return <QaIdentityArt name={name} fallback={<span className={'token-art tone-'+n} aria-hidden="true"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="currentColor" opacity=".13"/><path d="m16 39 11-20h9l-5 11h17L32 48l5-12H23l-4 7Z" fill="currentColor"/></svg></span>}/>;
}
export function NftArt({name,level,concealed=false}:{name:string;level?:number;concealed?:boolean}){
 const n=[...name].reduce((a,c)=>a+c.charCodeAt(0),0)%3;
 return <figure className={'nft-art tone-'+n} aria-label={concealed?'Unrevealed NFT placeholder':'Illustrative NFT placeholder for '+name}>
 <svg viewBox="0 0 320 240" role="img" aria-label="Placeholder artwork"><circle cx="160" cy="115" r="95" fill="currentColor" opacity=".08"/><path d="M0 196 320 76v164H0Z" fill="currentColor" opacity=".07"/>
 {concealed?<text x="160" y="142" textAnchor="middle" fontSize="80" fill="currentColor">?</text>:<g className="art-character"><path d="m105 83-8-34 40 23h46l40-23-8 34 16 37-15 56-56 19-56-19-15-56Z" fill="currentColor"/><path d="m112 110 35 7-13 19-22-6Zm96 0-35 7 13 19 22-6Z" fill="white"/><path d="m148 151 12 10 12-10" fill="none" stroke="white" strokeWidth="5" strokeLinecap="round"/></g>}
 <circle cx="55" cy="64" r="5" fill="currentColor"/><path d="M261 154v20m-10-10h20" stroke="currentColor" strokeWidth="3"/>
 </svg><figcaption><span>Placeholder art</span>{!concealed&&level!=null&&<strong>Level {level}</strong>}</figcaption></figure>;
}
export function Journey({steps}:{steps:[string,string][]}){return <ol className="journey" aria-label="How it works">{steps.map(([title,text],i)=><li key={title}><span className="step-number">{i+1}</span><div><strong>{title}</strong><p>{text}</p></div></li>)}</ol>;}
export function ProgressBar({value,total,label}:{value:string;total:string;label:string}){
 let percent=0;try{const t=BigInt(total);percent=t>0n?Number(BigInt(value)*100n/t):0;}catch{}percent=Math.max(0,Math.min(100,percent));
 return <div className="reward-progress"><progress max="100" value={percent} aria-label={label}/><span>{percent}% unlocked</span></div>;
}

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
export {CollectionArt as NftArt} from './collection-art';
export function Journey({steps}:{steps:[string,string][]}){return <ol className="journey" aria-label="How it works">{steps.map(([title,text],i)=><li key={title}><span className="step-number">{i+1}</span><div><strong>{title}</strong><p>{text}</p></div></li>)}</ol>;}
export function ProgressBar({value,total,label}:{value:string;total:string;label:string}){
 let percent=0;try{const t=BigInt(total);percent=t>0n?Number(BigInt(value)*100n/t):0;}catch{}percent=Math.max(0,Math.min(100,percent));
 return <div className="reward-progress"><progress max="100" value={percent} aria-label={label}/><span>{percent}% unlocked</span></div>;
}

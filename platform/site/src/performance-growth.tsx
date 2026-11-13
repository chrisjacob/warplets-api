import {useEffect,useId,useRef,useState} from 'react';
import {Panel,compact,utc} from './common';
import {dollarsMicros,tokenUnits} from './amounts';

export type PerformanceGrowthProps={
 wallet:string;label:string;asOf:string;peakUsdMicros:string|null;marketUsdMicros:string|null;
 historyIncomplete?:boolean;tokenCount:number;allocationCount:number;activeDays:number;firstAwardAt:string|null;
 categories:Array<{category:string;allocationCount:number}>;
 history:Array<{id:string;category:string;tokenId:string;symbol:string;decimals:number;awardedUnits:string;awardedAt:string}>;
};
const categoryNames:Record<string,string>={nfts:'NFTs',stake:'Stake',earn:'Earn'};
const xml=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]!));
function safeText(value:string,max:number){
 if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF\uD800-\uDFFF]/u.test(value))throw Error('Invalid performance card text.');
 return value.trim().replace(/\s+/g,' ');
}
function safeCount(value:number,maximum:number){if(!Number.isSafeInteger(value)||value<0||value>maximum)throw Error('Invalid performance count.');return value;}
function safeTime(value:string){
 if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value.replace(/(?<!\.\d{3})Z$/,'.000Z'))throw Error('Invalid performance snapshot date.');
 return value;
}
function cardDollars(value:string|null){
 if(value===null)throw Error('Complete snapshot pricing is required for a card.');
 if(typeof value!=='string'||!/^\d{1,100}$/.test(value))throw Error('Invalid performance valuation.');
 const amount=BigInt(value);if(amount>0n&&amount<10000n)return '< US$0.01';
 const full=dollarsMicros(value);if(full.length<=23)return full;
 const whole=(amount/1000000n).toString();return '≈ US$'+whole[0]+'.'+whole.slice(1,3)+'e+'+(whole.length-1);
}

/** These are aggregate history facts, not streaks, points or additional reward entitlements. */
export function earnedMilestones(profile:Pick<PerformanceGrowthProps,'allocationCount'|'activeDays'|'firstAwardAt'|'categories'>){
 const awards=safeCount(profile.allocationCount,100000),days=safeCount(profile.activeDays,100000);
 if(days>awards)throw Error('Award-day count exceeds award history.');
 const milestones:Array<{id:string;title:string;detail:string}>=[];
 if(awards>0&&profile.firstAwardAt)milestones.push({id:'first',title:'First recorded award',detail:utc(safeTime(profile.firstAwardAt))});
 if(awards>0&&days>=30)milestones.push({id:'days',title:'30 recorded award days',detail:days.toLocaleString()+' distinct UTC days with recorded awards. This is not a streak.'});
 const sources=new Set(profile.categories.filter(category=>Object.hasOwn(categoryNames,category.category)&&Number.isSafeInteger(category.allocationCount)&&category.allocationCount>0).map(category=>category.category));
 if(awards>0&&sources.size===3)milestones.push({id:'categories',title:'Across the ecosystem',detail:'Awards from NFTs, Stake and Earn.'});
 return milestones;
}

/** Download-only, self-contained image. All dynamic values enter escaped text nodes. */
export function buildPerformanceCardSvg(profile:PerformanceGrowthProps){
 const label=safeText(profile.label,160),wallet=safeText(profile.wallet,128),asOf=safeTime(profile.asOf);
 if(!/^[A-Za-z0-9._:-]+$/.test(wallet))throw Error('Invalid card wallet.');
 const peak=cardDollars(profile.peakUsdMicros),market=cardDollars(profile.marketUsdMicros);
 const tokens=safeCount(profile.tokenCount,5000),awards=safeCount(profile.allocationCount,100000),days=safeCount(profile.activeDays,100000);
 if(days>awards)throw Error('Award-day count exceeds award history.');
 const displayLabel=[...label].length>40?[...label].slice(0,39).join('')+'…':label;
 const text=(x:number,y:number,size:number,fill:string,value:string,weight=400)=>`<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}">${xml(value)}</text>`;
 return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="card-title card-description">
<title id="card-title">10X.MEME synthetic reward snapshot</title><desc id="card-description">Synthetic QA illustration. Peak and Market are theoretical valuations of lifetime token awards, not cash proceeds or personal trading profit.</desc>
<rect width="1200" height="630" rx="24" fill="#f6f7f1"/><path d="M850 0h350v215Z" fill="#d7f86b" opacity=".35"/>
<g font-family="Arial,Helvetica,sans-serif">
${text(60,70,34,'#20392b','10X.MEME',900)}<rect x="910" y="35" width="230" height="46" rx="23" fill="#20392b"/>${text(934,65,20,'#d7f86b','SYNTHETIC QA',700)}
${text(60,148,Math.min(38,Math.floor(1040/[...displayLabel].length)),'#18281f',displayLabel,700)}${text(60,186,20,'#536458',compact(wallet)+' · Snapshot '+utc(asOf))}
${text(60,241,19,'#536458','THEORETICAL LIFETIME AWARDS',700)}
<rect x="60" y="263" width="525" height="163" rx="18" fill="#20392b"/><rect x="610" y="263" width="530" height="163" rx="18" fill="#ffffff" stroke="#d8dfd4"/>
${text(88,307,20,'#d7f86b','Peak valuation',700)}${text(88,376,peak.length>18?36:48,'#ffffff',peak,700)}
${text(638,307,20,'#536458','Market valuation',700)}${text(638,376,market.length>18?36:48,'#20392b',market,700)}
${text(60,476,22,'#20392b',tokens.toLocaleString('en-US')+' token types · '+awards.toLocaleString('en-US')+' dated awards · '+days.toLocaleString('en-US')+' award days',700)}
${text(60,532,20,'#536458','Peak uses historical highs. Market uses snapshot prices.')}
${text(60,562,20,'#536458','Actual sale values depend on liquidity and fees. Awarded tokens may already be claimed.')}
${text(60,599,17,'#536458','Synthetic illustration only · No real funds or verified achievement')}
</g></svg>`;
}

export function PerformanceGrowth(props:PerformanceGrowthProps){
 const [message,setMessage]=useState(''),noticeId=useId(),downloads=useRef(new Map<string,number>());
 useEffect(()=>{
  setMessage('');
  return ()=>{for(const [url,timer] of downloads.current){window.clearTimeout(timer);URL.revokeObjectURL(url);}downloads.current.clear();};
 },[props.wallet,props.asOf]);
 const milestones=earnedMilestones(props),priced=props.peakUsdMicros!==null&&props.marketUsdMicros!==null;
 const history=props.history.slice(0,5);
 const download=()=>{
  let url:string|undefined;
  try{
   const svg=buildPerformanceCardSvg(props);url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
   const link=document.createElement('a');link.href=url;link.download='10x-synthetic-rewards-'+props.asOf.slice(0,10)+'.svg';link.hidden=true;document.body.append(link);
   try{link.click();}finally{link.remove();}
   const objectUrl=url;downloads.current.set(objectUrl,window.setTimeout(()=>{URL.revokeObjectURL(objectUrl);downloads.current.delete(objectUrl);},1000));
   setMessage('Card prepared. Your browser handles the download.');
  }catch{if(url)URL.revokeObjectURL(url);setMessage('The card could not be prepared. Check that this snapshot has complete pricing.');}
 };
 return <Panel title="Reward milestones">
  <p className="fixture-label">Synthetic QA history · {utc(props.asOf)}</p>
  <div className="profile-tokens">
   <article><h3>Earned along the way</h3>{milestones.length?<ul className="review-criteria" aria-label="Earned milestones">{milestones.map(milestone=><li key={milestone.id}><strong>{milestone.title}</strong><p>{milestone.detail}</p></li>)}</ul>:<p>Milestones appear after the first award in this history.</p>}<p className="muted">Milestones describe past awards. They do not unlock extra rewards.</p></article>
   <article><h3>Recent awards</h3>{history.length?<ul className="recent-awards">{history.map(award=><li key={award.id}><div><strong>{tokenUnits(award.awardedUnits,award.decimals)} {award.symbol}</strong><p>{Object.hasOwn(categoryNames,award.category)?categoryNames[award.category]:'Reward'} · <time dateTime={award.awardedAt}>{utc(award.awardedAt)}</time></p></div></li>)}</ul>:<p>No awarded tokens in this snapshot yet.</p>}</article>
  </div>
  {props.historyIncomplete&&<p>Accrued staking rewards count toward valuations. They are omitted from dated history because their individual award dates are unavailable.</p>}
  <h3>Keep a snapshot</h3><p id={noticeId}>{priced?'Download a labelled synthetic card with both Peak and Market values. This saves a file; it does not post anywhere.':'A card is available when both snapshot values have complete pricing. Missing values are not shown as zero.'}</p>
  <button type="button" disabled={!priced} aria-describedby={noticeId} onClick={download}>Download synthetic card</button>
  <p role="status" aria-live="polite">{message}</p>
 </Panel>;
}

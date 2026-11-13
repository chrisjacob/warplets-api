/** Immutable, bounded projection. Values are theoretical USD micro-units, never proceeds. */
const categories=['nfts','stake','earn'],allCategories=['tokens','airdrops',...categories];
const require=(value,message)=>{if(!value)throw new TypeError(message);};
const integer=(value,name)=>{require(typeof value==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(value),'Invalid '+name);return BigInt(value);};
const positive=(value,name)=>{const n=integer(value,name);require(n>0n,'Nonpositive '+name);return n;};
const time=(value)=>{require(typeof value==='string'&&/^\d{4}-\d\d-\d\dT/.test(value)&&Number.isFinite(Date.parse(value)),'Invalid timestamp');return Date.parse(value);};
const identity=value=>{require(typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value),'Invalid identity');return value;};
const label=value=>{require(typeof value==='string'&&value.length>0&&value.length<=160,'Invalid label');return value;};
const order=(a,b)=>a<b?-1:a>b?1:0;
function decimal(value){require(typeof value==='string'&&/^(0|[1-9][0-9]{0,38})(\.[0-9]{1,18})?$/.test(value),'Invalid reference price');const [a,b='']=value.split('.');const n=BigInt(a+b),d=10n**BigInt(b.length);require(n>0n,'Nonpositive reference price');return {n,d};}
const cmp=(a,b)=>a.n*b.d>b.n*a.d?1:a.n*b.d<b.n*a.d?-1:0;
const usd=(quantity,price,decimals)=>price===null?null:(quantity*price.n/(10n**BigInt(decimals)*price.d)).toString();
const multiple=(price,launch)=>price&&launch?{n:price.n*launch.d,d:price.d*launch.n}:null;
const displayRatio=value=>value?(value.n*10000n/value.d/10000n).toString()+'.'+(value.n*10000n/value.d%10000n).toString().padStart(4,'0'):null;
export function createPerformanceService(input){
 require(input?.schemaVersion===1&&input.mode==='synthetic-local','Only explicit synthetic local snapshots are supported; verified price publication is not enabled.');
 require(Array.isArray(input.tokens)&&input.tokens.length<=5000&&Array.isArray(input.participants)&&input.participants.length<=10000&&Array.isArray(input.rewards)&&input.rewards.length<=100000,'Snapshot exceeds bounded collection limits');
 const asOf=input.asOf,at=time(asOf),tokens=new Map(),people=new Map(),rewards=new Map();
 for(const p of input.participants){identity(p.wallet);require(!people.has(p.wallet),'Duplicate participant');people.set(p.wallet,{wallet:p.wallet,label:label(p.label),events:[],groups:new Map()});}
 for(const raw of input.tokens){
  const id=identity(raw.id);require(!tokens.has(id),'Duplicate token');require(Number.isInteger(raw.decimals)&&raw.decimals>=0&&raw.decimals<=18,'Invalid decimals');
  const supply=positive(raw.supplyUnits,'supply'),launch=raw.launchPriceMicros===null?null:decimal(raw.launchPriceMicros),launchAt=time(raw.launchAt);
  require(launchAt<=at&&Array.isArray(raw.observations)&&raw.observations.length<=1000,'Invalid launch or observation bound');
  let peak=null,current=null,latest=-1,peakAt=null;const seen=new Set();
  for(const o of raw.observations){
   identity(o.id);require(!seen.has(o.id),'Duplicate observation');seen.add(o.id);
   require(['accepted','rejected'].includes(o.quality),'Observation must have a quality decision');
   if(o.quality==='rejected'){require(typeof o.reason==='string'&&o.reason.length>0,'Rejected observation needs a reason');continue;}
   const observed=time(o.at),ogObserved=time(o.ogObservedAt);
   require(observed>=launchAt&&observed<=at&&Math.abs(observed-ogObserved)<=60000&&ogObserved<=at,'Price observations are not contemporaneous or within snapshot bounds');
   label(o.source);identity(o.poolId);
   const price={n:positive(o.attOgNumerator,'ATT/OG numerator')*positive(o.ogUsdMicros,'OG USD price'),d:positive(o.attOgDenominator,'ATT/OG denominator')};
   if(!peak||cmp(price,peak)>0){peak=price;peakAt=o.at;}
   if(observed>latest){current=price;latest=observed;}else if(observed===latest)require(cmp(price,current)===0,'Conflicting prices at the same timestamp');
  }
  if(at-latest>900000)current=null;
  tokens.set(id,{id,symbol:label(raw.symbol),decimals:raw.decimals,supply,launch,peak,current,peakAt});
 }
 for(const r of input.rewards){
  identity(r.id);require(categories.includes(r.category)&&tokens.has(r.tokenId)&&people.has(r.wallet),'Unknown reward source, token or recipient');
  const awarded=integer(r.awardedUnits,'awarded quantity'),vested=integer(r.vestedUnits,'vested quantity'),claimed=integer(r.claimedUnits,'claimed quantity');
  require(awarded>=vested&&vested>=claimed&&time(r.awardedAt)<=at,'Invalid reward state or unawarded future emission');
  const canonical=JSON.stringify([r.wallet,r.tokenId,r.category,r.awardedUnits,r.vestedUnits,r.claimedUnits,r.awardedAt]);
  if(rewards.has(r.id)){require(rewards.get(r.id)===canonical,'Conflicting reward ID');continue;}
  rewards.set(r.id,canonical);const p=people.get(r.wallet);p.events.push({...r,awarded,vested,claimed});
 }
 function aggregate(events){
  const map=new Map();for(const e of events){const t=tokens.get(e.tokenId);const row=map.get(t.id)??{tokenId:t.id,symbol:t.symbol,decimals:t.decimals,awarded:0n,claimable:0n};row.awarded+=e.awarded;row.claimable+=e.vested-e.claimed;map.set(t.id,row);}
  return [...map.values()].sort((a,b)=>order(a.tokenId,b.tokenId)).map(r=>{const t=tokens.get(r.tokenId);return {tokenId:r.tokenId,symbol:r.symbol,decimals:r.decimals,awardedUnits:r.awarded.toString(),claimableUnits:r.claimable.toString(),peakUsdMicros:usd(r.awarded,t.peak,t.decimals),marketUsdMicros:usd(r.awarded,t.current,t.decimals)};});
 }
 const sum=(rows,key)=>rows.some(r=>r[key]===null)?null:rows.reduce((n,r)=>n+BigInt(r[key]),0n).toString();
 for(const p of people.values())for(const category of ['airdrops',...categories]){const events=category==='airdrops'?p.events:p.events.filter(r=>r.category===category),items=aggregate(events);p.groups.set(category,{items,peakUsdMicros:sum(items,'peakUsdMicros'),marketUsdMicros:sum(items,'marketUsdMicros'),allocationCount:events.length});}
 const boards=new Map(),ranking=new Map();
 for(const category of allCategories)for(const mode of ['peak','market']){
  let entries=[];const valueKey=mode==='peak'?'peakUsdMicros':'marketUsdMicros';
  if(category==='tokens')entries=[...tokens.values()].map(t=>({participantId:t.id,wallet:null,label:t.symbol,peakUsdMicros:usd(t.supply,t.peak,t.decimals),marketUsdMicros:usd(t.supply,t.current,t.decimals),tokenCount:1,allocationCount:0,awardedTokens:[],multiple:displayRatio(multiple(mode==='peak'?t.peak:t.current,t.launch)),sort:multiple(mode==='peak'?t.peak:t.current,t.launch)}));
  else entries=[...people.values()].filter(p=>p.groups.get(category).allocationCount>0).map(p=>{const g=p.groups.get(category);return {participantId:p.wallet,wallet:p.wallet,label:p.label,peakUsdMicros:g.peakUsdMicros,marketUsdMicros:g.marketUsdMicros,tokenCount:g.items.length,allocationCount:g.allocationCount,awardedTokens:g.items.slice(0,3).map(({tokenId,symbol,decimals,awardedUnits,claimableUnits})=>({tokenId,symbol,decimals,awardedUnits,claimableUnits})),multiple:null,sort:g[valueKey]===null?null:{n:BigInt(g[valueKey]),d:1n}};});
  const known=entries.filter(e=>e.sort!==null);known.sort((a,b)=>-cmp(a.sort,b.sort)||order(a.participantId,b.participantId));
  const ranked=known.map(({sort,...r},i)=>({...r,rank:i+1}));boards.set(category+':'+mode,{items:ranked,totalParticipants:entries.length,unrankedCount:entries.length-known.length});ranking.set(category+':'+mode,new Map(ranked.map(r=>[r.participantId,r])));
 }
 const activity=[...people.values()].flatMap(p=>p.events.map(r=>({id:r.id,wallet:p.wallet,label:p.label,category:r.category,tokenId:r.tokenId,symbol:tokens.get(r.tokenId).symbol,decimals:tokens.get(r.tokenId).decimals,awardedUnits:r.awardedUnits,awardedAt:r.awardedAt}))).sort((a,b)=>time(b.awardedAt)-time(a.awardedAt)||order(a.id,b.id)).slice(0,50);
 const meta={mode:'synthetic-local',asOf};
 return Object.freeze({
  board(category,{mode='peak',limit=100,wallet=null}={}){require(allCategories.includes(category)&&['peak','market'].includes(mode)&&Number.isInteger(limit)&&limit>=1&&limit<=100,'Invalid board request');const b=boards.get(category+':'+mode);return structuredClone({...meta,category,valuationMode:mode,totalParticipants:b.totalParticipants,unrankedCount:b.unrankedCount,items:b.items.slice(0,limit),myRank:ranking.get(category+':'+mode).get(wallet)??null});},
  profile(wallet,{cursor=0,limit=20}={}){require(Number.isInteger(cursor)&&cursor>=0&&Number.isInteger(limit)&&limit>=1&&limit<=100,'Invalid profile pagination');const p=people.get(wallet);if(!p)return null;const total=p.groups.get('airdrops');return structuredClone({...meta,wallet,label:p.label,peakUsdMicros:total.peakUsdMicros,marketUsdMicros:total.marketUsdMicros,valuationComplete:total.peakUsdMicros!==null&&total.marketUsdMicros!==null,categories:categories.map(category=>{const g=p.groups.get(category);return {category,peakUsdMicros:g.peakUsdMicros,marketUsdMicros:g.marketUsdMicros,allocationCount:g.allocationCount};}),ranks:Object.fromEntries(['airdrops',...categories].map(category=>[category,ranking.get(category+':peak').get(wallet)?.rank??null])),items:total.items.slice(cursor,cursor+limit),nextCursor:cursor+limit<total.items.length?String(cursor+limit):null});},
  activity(limit=5){require(Number.isInteger(limit)&&limit>=1&&limit<=50,'Invalid activity limit');return structuredClone({...meta,items:activity.slice(0,limit)});},
  metrics(){return {tokenCount:tokens.size,participantCount:people.size,rewardCount:rewards.size};}
 });
}

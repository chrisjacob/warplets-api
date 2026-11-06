// Pure legacy calculator core. contextId is supplied only by the local crypto
// wrappers; this internal arithmetic function does not verify source authority.
import { assessPilotBudget, assessRecurring } from './budget.mjs';
import { scenarioCatalog } from './scenarios.mjs';

const LAMPORTS=1_000_000_000n;
const integer=(value,label)=>{
  if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,79})$/.test(value)) throw new RangeError(`${label} must be a decimal base-unit string`);
  return BigInt(value);
};
const at=(value,label)=>{
  if(!Number.isSafeInteger(value)||value<0)throw new RangeError(`Invalid ${label} timestamp`);
  return value;
};
const ceil=(n,d)=>(n+d-1n)/d;
const optionRanges={
  freshAtasPerUser:[0,10],newStakers:[0,10000],dailyClaimants:[0,1000],
  vaultClaimsPerUser:[0,10],vaultLookupSetups:[0,10000],
  seasonPaid:[0,1000],seasonFree:[0,1000],seasonFounder:[0,1000],unsoldFounderMints:[0,1000],
  upgradeLevel:[1,9],upgradeCount:[0,1000],priorRerolls:[0,40],rerollCount:[0,1000],netCompanyFeeBps:[0,10000],
};
function parameters(input={}) {
  for(const k of Object.keys(input)) if(!Object.hasOwn(optionRanges,k))throw new TypeError('Unknown parameter: '+k);
  const p={};
  for(const [k,[min,max]] of Object.entries(optionRanges)) {
    const value=input[k]??null;
    if(value!==null&&(!Number.isInteger(value)||value<min||value>max)) throw new RangeError('Out of range: '+k);
    p[k]=value;
  }
  if((p.seasonPaid??0)+(p.seasonFree??0)+(p.seasonFounder??0)>1000) throw new RangeError('Season mints exceed 1,000 reserved slots');
  return p;
}
function provenance(q,now) {
  if (!q.sourceRef || typeof q.sourceRef!=='string') throw new TypeError('A sourced quote or reference is required');
  at(q.observedMs,'observation');
  if(q.observedMs>now) throw new RangeError('Quote observed in the future');
  if(!['quoted','upper-bound','reference','hypothetical'].includes(q.kind)) throw new TypeError('Unsupported quote kind');
  if(['reference','hypothetical'].includes(q.kind))return q.kind;
  at(q.expiresMs,'quote expiry');
  if(q.expiresMs<q.observedMs)throw new RangeError('Quote expiry precedes observation');
  return q.expiresMs<=now?'expired':q.kind;
}
function contextGaps(ctx={},now) {
  const gaps=[];
  for(const key of ['network','slot','instructionSetHash','programSetHash','fundingStateHash','blockhash','simulationRef']) {
    if(typeof ctx[key]!=='string'||ctx[key].trim()==='')gaps.push(key);
  }
  if(!Number.isSafeInteger(ctx.validUntilMs)||ctx.validUntilMs<=now)gaps.push('fresh execution context');
  if(ctx.slot!=null&&!/^\d+$/.test(ctx.slot))gaps.push('numeric source slot');
  return gaps;
}
export function executionContextPreimage(ctx={}) {
  const keys=['network','slot','instructionSetHash','programSetHash','fundingStateHash','blockhash','simulationRef','validUntilMs','ogMint'];
  return JSON.stringify(keys.map(key=>ctx[key]??null));
}
function conversion(unit,fx,now) {
  if(unit==='microUSD')return {num:1n,den:1n,status:'quoted'};
  const rate=fx?.[unit==='lamport'?'sol':'og'];
  if(!rate)return null;
  const num=integer(rate.microUsdPerWhole,'USD conversion');
  if(num===0n)throw new RangeError('Conversion must be positive');
  if(unit==='ogRaw'&&(!Number.isInteger(rate.decimals)||rate.decimals<0||rate.decimals>18))throw new RangeError('Missing OG mint decimals');
  return {num,den:unit==='lamport'?LAMPORTS:10n**BigInt(rate.decimals),status:provenance(rate,now),sourceRef:rate.sourceRef};
}
const accepted=s=>s==='quoted'||s==='upper-bound'||s==='product-policy';
function quoteLine(line,input,contextId) {
  const {asOfMs,quotes={},fx={}}=input;
  const {id,label,payer,kind,unit,quantity}=line;
  const base={id,label,payer,kind,unit,quantity};
  if(quantity===0) return {...base,status:'zero-count',unitAmount:null,total:'0',usdMicros:'0',problems:[]};
  const q=quotes[id];
  let amount=null,status='missing-quote',sourceRef=null;
  if(Object.hasOwn(line,'formulaAmount')) {
    amount=line.formulaAmount;status=amount===null?'missing-input':'product-policy';sourceRef='PRD v1.2 Season progression';
  } else if(q) {
    if(q.unit!==unit) throw new TypeError(`Mismatched denomination for ${id}`);
    amount=String(integer(q.amount,id));status=provenance(q,asOfMs);sourceRef=q.sourceRef;
  }
  const problems=[];
  if(!accepted(status))problems.push(status);
  if(quantity===null)problems.push('missing-count');
  if(kind==='rent' && q && !q.accountLayoutRef)problems.push('account sizes/existence unchecked');
  let accounts=null,refundableUnits=null;
  if(kind==='rent' && q && ['quoted','upper-bound'].includes(q.kind)) {
    if(!Array.isArray(q.accounts))problems.push('account records missing');
    else {
      accounts=q.accounts.map(a=>{
        if(!a || typeof a.role!=='string' || !a.role || !Number.isInteger(a.bytes) || a.bytes<0
            || typeof a.exists!=='boolean') throw new TypeError('Invalid account layout for '+id);
        const needed=integer(a.additionalLamports,'additional account rent');
        return {role:a.role,bytes:a.bytes,exists:a.exists,additionalLamports:String(needed)};
      });
      if(accounts.reduce((sum,a)=>sum+BigInt(a.additionalLamports),0n)!==BigInt(amount))problems.push('rent does not match checked accounts');
    }
    if(q.expectedRefundableUnits!==undefined) {
      refundableUnits=integer(q.expectedRefundableUnits,'expected refundable');
      if(refundableUnits>BigInt(amount))throw new RangeError('Expected refund exceeds upfront cost');
    }
  }
  if(q && ['quoted','upper-bound'].includes(q.kind) && unit!=='microUSD' &&
    (typeof q.slot!=='string'||!/^\d+$/.test(q.slot)||q.network!==input.context?.network||
      (/^\d+$/.test(input.context?.slot??'') && BigInt(q.slot)>BigInt(input.context.slot)))) {
    problems.push('missing or mismatched quote slot/network');
  }
  if(q && ['quoted','upper-bound'].includes(q.kind) && unit!=='microUSD' && q.contextId!==contextId) {
    problems.push('quote context changed or unbound');
  }
  if(unit==='ogRaw' && totalIsNonzero(amount) && (!input.context?.ogMint||q?.mint!==input.context.ogMint
    || fx.og?.mint!==input.context.ogMint))problems.push('OG mint mismatch');
  const total=quantity===null||amount===null?null:BigInt(quantity)*BigInt(amount);
  const rate=total===null||total===0n?null:conversion(unit,fx,asOfMs);
  if(total!==null&&total>0n&&!rate)problems.push('missing USD conversion');
  if(rate&&!accepted(rate.status))problems.push('conversion '+rate.status);
  const usd=total===null?null:total===0n?0n:!rate?null:
    (kind==='receipt'?total*rate.num/rate.den:ceil(total*rate.num,rate.den));
  return {...base,status,unitAmount:amount,total:total===null?null:String(total),usdMicros:usd===null?null:String(usd),
    sourceRef,observedMs:q?.observedMs??null,expiresMs:q?.expiresMs??null,accountLayoutRef:q?.accountLayoutRef??null,
    refundable:q?.refundable??'unverified',expectedRefundableUnitsPerEvent:refundableUnits===null?null:String(refundableUnits),
    accountsPerEvent:accounts,slot:q?.slot??null,contextId:q?.contextId??null,fxSourceRef:rate?.sourceRef??null,problems};
}
function totalIsNonzero(amount) {return amount!==null&&BigInt(amount)>0n;}

function sumRows(lines) {
  const payers={};
  for(const row of lines) {
    const p=payers[row.payer]??={pricedByUnit:{lamport:0n,ogRaw:0n,microUSD:0n},pricedUsdMicros:0n,missing:[],complete:true};
    if(row.total!==null)p.pricedByUnit[row.unit]+=BigInt(row.total);
    if(row.usdMicros!==null)p.pricedUsdMicros+=BigInt(row.usdMicros);
    if(row.problems.length) {p.complete=false;p.missing.push({term:row.id,problems:row.problems});}
  }
  return Object.fromEntries(Object.entries(payers).map(([payer,t])=>[payer,{...t,pricedUsdMicros:String(t.pricedUsdMicros),
    pricedByUnit:Object.fromEntries(Object.entries(t.pricedByUnit).map(([k,v])=>[k,String(v)]))}]));
}
function buildScenario(s,input,gaps,cash,contextId) {
  const lines=s.lines.map(l=>quoteLine(l,input,contextId)), byPayer=sumRows(lines);
  const unverified=lines.some(l=>l.problems.length);
  const founder=byPayer.founder;
  let pilotBudget=null;
  if(s.id!==14 && cash!==null && !gaps.length && (founder?.complete??true)) {
    pilotBudget=assessPilotBudget(BigInt(founder?.pricedUsdMicros??'0'),cash);
  }
  const extra={};
  if(s.id===13) {
    const ceiling=input.founderBackstopApprovedUsdMicros;
    extra.backstopStatus=s.lines[0].quantity===0?'unused':ceiling==null?'spend-approval-required':!founder?.complete?'incomplete':
      BigInt(founder.pricedUsdMicros)>integer(ceiling,'backstop approval')?'over-approved-amount':'within-approved-amount';
  }
  if(s.id===14) {
    const recurring=lines.filter(l=>l.id.startsWith('recurring'));
    const complete=recurring.every(r=>r.problems.length===0);
    extra.recurringBudget=complete?assessRecurring(recurring.reduce((n,r)=>n+BigInt(r.usdMicros),0n)):{status:'unquoted'};
    const mintReceipts=lines.find(l=>l.id==='realizedMintReceipts');
    const feeReceipts=lines.find(l=>l.id==='realizedFeeReceipts');
    const knownCosts=founder?.complete&&!gaps.length;
    const cost=knownCosts?BigInt(founder.pricedUsdMicros):null;
    const beforeTrading=cost===null||mintReceipts.problems.length?null:cost-BigInt(mintReceipts.usdMicros);
    const rate=input.parameters.netCompanyFeeBps;
    extra.outcomes={zeroDemandNetUsdMicros:cost===null?null:String(-cost),zeroTradingNetUsdMicros:beforeTrading===null?null:String(-beforeTrading),
      realizedNetUsdMicros:beforeTrading===null||feeReceipts.problems.length?null:String(BigInt(feeReceipts.usdMicros)-beforeTrading),
      breakEvenTradingVolumeUsdMicros:beforeTrading===null?null:beforeTrading<=0n?'0':!rate?null:String(ceil(beforeTrading*10_000n,BigInt(rate)))};
  }
  return {id:s.id,name:s.name,scope:s.scope,status:unverified||gaps.length?'incomplete':'quoted',byPayer,lines,pilotBudget,...extra};
}
export function calculateCostPacket(input,contextId) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('Expected a scenario packet object');
  const now=at(input.asOfMs,'evaluation');const p=parameters(input.parameters),catalog=scenarioCatalog(p);
  const allowed=new Set(catalog.flatMap(s=>s.lines.map(l=>l.id)));
  for(const id of Object.keys(input.quotes??{}))if(!allowed.has(id))throw new TypeError('Unknown quote term: '+id);
  const gaps=contextGaps(input.context,now);
  const cash=input.availableCashUsdMicros==null?null:integer(input.availableCashUsdMicros,'available cash');
  const normalized={...input,parameters:p};
  const scenarios=catalog.map(s=>buildScenario(s,normalized,gaps,cash,contextId));
  // Aggregate disjoint costs for the representative first ATT; no founder-sponsored
  // user ATAs or harvested-token top-up. None of these plans can execute.
  const single={id:'first-att',name:'Full first ATT with its farm, first Earn root and Vault snapshot',
    scope:'One base launch, one farm, one root, one pooled checkpoint; claimant expenses shown separately.',
    lines:[...catalog[0].lines,...catalog[1].lines.filter(l=>l.payer==='founder'),
      ...catalog[3].lines.filter(l=>l.id.startsWith('earn')).map(l=>({...l,quantity:1})),...catalog[4].lines]};
  return {mode:'planning-only',version:'prd-1.2',asOfMs:now,contextGaps:gaps,parameters:p,
    executionContextId:contextId,quoteContext:input.context??null,
    conversionSources:{sol:input.fx?.sol?.sourceRef??null,og:input.fx?.og?.sourceRef??null},
    scenarios,firstAtt:buildScenario(single,normalized,gaps,cash,contextId)};
}

/** Bounded caller-supplied planning assumptions only. No evidence is verified,
 * no timestamp is renewed, and no closure or amount grants spending authority. */
export const CASHFLOW_FORMAT='10x.cashflow.v1';
export const CASHFLOW_LIMITS=Object.freeze({operations:16,charges:64,inputBytes:65536,count:10000,amountDigits:80});
const need=(value,message)=>{if(!value)throw new TypeError('Invalid cashflow graph: '+message);};
function exact(value,keys){need(value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value)),'object');const names=Reflect.ownKeys(value);need(names.length===keys.length&&names.every(k=>typeof k==='string'&&keys.includes(k)),'fields');const result={};for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key);need(d&&d.enumerable&&Object.hasOwn(d,'value'),'data fields');result[key]=d.value;}return result;}
function list(value,max){need(Array.isArray(value)&&Object.getPrototypeOf(value)===Array.prototype&&value.length<=max,'array bound');const keys=Reflect.ownKeys(value);need(keys.length===value.length+1,'array fields/holes');for(let i=0;i<value.length;i++){const d=Object.getOwnPropertyDescriptor(value,String(i));need(d&&d.enumerable&&Object.hasOwn(d,'value'),'array data');}return value;}
const id=v=>{need(typeof v==='string'&&/^[A-Za-z0-9:_./-]{1,128}$/.test(v),'identifier');return v;};
const amount=v=>{need(v===null||typeof v==='string'&&/^(0|[1-9][0-9]{0,79})$/.test(v),'decimal amount');return v;};
const frozen=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(frozen);Object.freeze(v);}return v;};
const sum=values=>values.some(v=>v===null)?null:values.reduce((n,v)=>n+v,0n);
const known=values=>values.reduce((n,v)=>n+(v??0n),0n);
const decimal=v=>v===null?null:String(v);

/** Maximum funding over every dependency-valid completed prefix and all its
 * concurrently ready operations. Charge at start; refund only on completion.
 * This deliberately does not select a cheap topological order. */
export function evaluateCashflow(value){
 const input=exact(value,['format','operations','charges','interruption']);need(input.format===CASHFLOW_FORMAT,'format');
 list(input.operations,16);list(input.charges,64);
 const operations=input.operations.map(v=>{const o=exact(v,['id','dependsOn']);id(o.id);list(o.dependsOn,16);return {id:o.id,dependsOn:o.dependsOn.map(id)};});
 const indices=new Map(operations.map((o,i)=>[o.id,i]));need(indices.size===operations.length,'duplicate operation');
 const parents=operations.map(o=>{need(new Set(o.dependsOn).size===o.dependsOn.length,'duplicate dependency');let mask=0;for(const parent of o.dependsOn){need(indices.has(parent)&&parent!==o.id,'unknown/self dependency');mask|=1<<indices.get(parent);}return mask;});
 const order=[],ancestors=Array(operations.length).fill(0);let done=0;
 while(order.length<operations.length){const next=parents.findIndex((p,i)=>!(done&(1<<i))&&(p&done)===p);need(next>=0,'cycle');ancestors[next]=parents[next];for(let i=0;i<operations.length;i++)if(parents[next]&(1<<i))ancestors[next]|=ancestors[i];done|=1<<next;order.push(next);}
 const seenIds=new Set(),shared=new Map(),aliases=[],charges=[],normalizedCharges=[];
 for(const v of input.charges){const c=exact(v,['id','operationId','sharedAccount','payer','unit','kind','count','unitAmount','expectedRefundableUnitAmount','closure']);id(c.id);need(!seenIds.has(c.id),'duplicate charge');seenIds.add(c.id);id(c.operationId);need(indices.has(c.operationId),'charge operation');
  need(typeof c.payer==='string'&&/^[A-Za-z0-9][A-Za-z0-9 :_./-]{0,127}$/.test(c.payer),'payer');need(['lamport','ogRaw','microUSD'].includes(c.unit)&&['consumed','rent'].includes(c.kind),'unit/kind');need(c.count===null||Number.isInteger(c.count)&&c.count>=0&&c.count<=10000,'count');amount(c.unitAmount);amount(c.expectedRefundableUnitAmount);
  need(c.sharedAccount===null||typeof c.sharedAccount==='string','shared account');if(c.sharedAccount!==null){id(c.sharedAccount);need(c.kind==='rent'&&(c.count===null||c.count<=1),'shared account count/kind');}
  let closure=null;if(c.closure!==null){closure=exact(c.closure,['operationId','status']);id(closure.operationId);need(indices.has(closure.operationId)&&['established','unknown'].includes(closure.status),'closure');const from=indices.get(c.operationId),to=indices.get(closure.operationId);need(from===to||!!(ancestors[to]&(1<<from)),'closure lacks dependency');}
  need(c.kind==='rent'||c.expectedRefundableUnitAmount==='0'&&closure===null&&c.sharedAccount===null,'consumed refund');if(c.unitAmount!==null&&c.expectedRefundableUnitAmount!==null)need(BigInt(c.expectedRefundableUnitAmount)<=BigInt(c.unitAmount),'refund exceeds upfront');
  const row={...c,closure};normalizedCharges.push(row);if(c.sharedAccount!==null){const previous=shared.get(c.sharedAccount);if(previous){const {id:oldId,...old}=previous,{id:newId,...current}=row;need(JSON.stringify(old)===JSON.stringify(current),'conflicting shared setup');aliases.push({id:newId,chargedAs:oldId});continue;}shared.set(c.sharedAccount,row);}charges.push(row);
 }
 let interruption=null;if(input.interruption!==null){const cut=exact(input.interruption,['completedOperationIds','startedOperationIds']);const mask=(ids,label)=>{list(ids,16);need(new Set(ids).size===ids.length,label);let bits=0;for(const name of ids){id(name);need(indices.has(name),label);bits|=1<<indices.get(name);}return bits;};const completed=mask(cut.completedOperationIds,'completed set'),started=mask(cut.startedOperationIds,'started set');need(!(completed&started),'overlapping interruption sets');for(let i=0;i<operations.length;i++){if((completed|started)&(1<<i))need((parents[i]&completed)===parents[i],'interruption dependency');}interruption={completedOperationIds:[...cut.completedOperationIds],startedOperationIds:[...cut.startedOperationIds],completed,started};}
 need(new TextEncoder().encode(JSON.stringify({format:input.format,operations,charges:normalizedCharges,interruption})).length<=65536,'byte bound');
 const groups=new Map(),unresolved=[];
 const rows=charges.map(c=>{const total=c.count===0?0n:c.count===null||c.unitAmount===null?null:BigInt(c.count)*BigInt(c.unitAmount),refund=c.count===0?0n:c.count===null?null:c.expectedRefundableUnitAmount==='0'?0n:c.expectedRefundableUnitAmount===null||c.closure?.status!=='established'?null:BigInt(c.count)*BigInt(c.expectedRefundableUnitAmount),consumed=total===null||refund===null?null:total-refund;
  const reasons=[];if(c.count!==0){if(c.count===null)reasons.push('unknown-count');if(c.unitAmount===null)reasons.push('unknown-amount');if(c.expectedRefundableUnitAmount===null)reasons.push('unknown-refundable-amount');if(c.kind==='rent'&&c.expectedRefundableUnitAmount!=='0'&&c.closure?.status!=='established')reasons.push('closure-not-established');}if(reasons.length)unresolved.push({chargeId:c.id,reasons});
  const key=JSON.stringify([c.payer,c.unit]);if(!groups.has(key))groups.set(key,{payer:c.payer,unit:c.unit,rows:[],peak:0n});const row={...c,total,refund,consumed,bit:1<<indices.get(c.operationId),closeBit:c.closure===null?0:1<<indices.get(c.closure.operationId)};groups.get(key).rows.push(row);return row;});
 const all=(1<<operations.length)-1;let evaluatedPrefixes=0;
 for(let completed=0;completed<=all;completed++){let ready=0,valid=true;for(let i=0;i<operations.length;i++){const bit=1<<i;if(completed&bit){if((parents[i]&completed)!==parents[i]){valid=false;break;}}else if((parents[i]&completed)===parents[i])ready|=bit;}if(!valid)continue;evaluatedPrefixes++;const funded=completed|ready;
  for(const group of groups.values()){if(group.rows.some(r=>r.total===null||r.refund===null))continue;let required=0n;for(const r of group.rows){if(funded&r.bit)required+=r.total;if(completed&r.closeBit)required-=r.refund;}if(required>group.peak)group.peak=required;}
 }
 const totals=[...groups.values()].map(g=>{const gross=sum(g.rows.map(r=>r.total)),consumed=sum(g.rows.map(r=>r.consumed)),refundable=sum(g.rows.map(r=>r.refund));let cut=null;
  if(interruption){const incurred=g.rows.filter(r=>(interruption.completed|interruption.started)&r.bit),open=incurred.filter(r=>r.kind==='rent'&&r.count!==0&&!(r.closure?.status==='established'&&(interruption.completed&r.closeBit))&&(r.closure!==null||r.expectedRefundableUnitAmount!=='0')),held=sum(open.map(r=>r.refund)),count=sum(open.map(r=>r.count===null?null:BigInt(r.count)));cut={incurredUpfront:decimal(sum(incurred.map(r=>r.total))),incurredKnownSubtotal:decimal(known(incurred.map(r=>r.total))),consumed:decimal(sum(incurred.map(r=>r.consumed))),heldFloat:decimal(held),heldFloatKnownSubtotal:decimal(known(open.map(r=>r.refund))),cleanup:{openAccountCount:decimal(count),additionalCost:count===0n?'0':null,status:count===0n?'none':'unquoted'}};}
  return {payer:g.payer,unit:g.unit,status:g.rows.some(r=>r.total===null||r.refund===null)?'incomplete':'calculated',grossUpfront:decimal(gross),grossKnownSubtotal:decimal(known(g.rows.map(r=>r.total))),peakUpfront:gross===null||refundable===null?null:decimal(g.peak),peakUpfrontUpperBound:decimal(gross),consumed:decimal(consumed),consumedKnownSubtotal:decimal(known(g.rows.map(r=>r.consumed))),expectedRefundable:decimal(refundable),refundableKnownSubtotal:decimal(known(g.rows.map(r=>r.refund))),interruption:cut};});
 return frozen({format:CASHFLOW_FORMAT,mode:'planning-only',assumptions:'caller-supplied-unverified',financialExecution:false,isAuthorization:false,operationCount:operations.length,distinctChargeCount:rows.length,deduplicated:aliases,evaluatedPrefixes,totals,unresolved});
}

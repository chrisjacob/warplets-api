import {evaluateCashflow,CASHFLOW_FORMAT} from './cashflow.mjs';
/** Project calculated terms without inventing account identities or successful
 * closure. Rent is prepared before execution; potential refunds remain unknown
 * until a separate retained closure proof can support a richer graph. */
export function scenarioCashflow(scenario){
 if(!scenario||!Array.isArray(scenario.lines)||scenario.lines.length>64)throw new TypeError('Invalid scenario terms');
 const receipts=[],charges=[],ids=new Set();
 for(const line of scenario.lines){
  if(line.kind==='receipt'){receipts.push({termId:line.id,payer:line.payer,unit:line.unit,amount:line.total,usdMicros:line.usdMicros,problems:[...line.problems]});continue;}
  const id=String(line.id)+':'+String(line.payer).replaceAll(' ','_');if(ids.has(id))throw new TypeError('Ambiguous scenario cost identity');ids.add(id);
  const rent=line.kind==='rent',refund=rent?(line.expectedRefundableUnitsPerEvent??null):'0';
  charges.push({id,operationId:rent?'prepare':'execute',sharedAccount:null,payer:line.payer,unit:line.unit,kind:rent?'rent':'consumed',
   count:line.quantity,unitAmount:line.unitAmount,expectedRefundableUnitAmount:refund,
   closure:rent&&refund!=='0'?{operationId:'execute',status:'unknown'}:null});
 }
 const graph={format:CASHFLOW_FORMAT,operations:[{id:'prepare',dependsOn:[]},{id:'execute',dependsOn:['prepare']}],charges,interruption:null};
 return {format:'10x.scenario-cashflow.v1',scenarioId:scenario.id,graph,result:evaluateCashflow(graph),receipts,
  limitations:['account-identities-not-supplied-no-cross-term-deduplication','closure-not-established-by-cost-quote'],financialExecution:false,isAuthorization:false};
}

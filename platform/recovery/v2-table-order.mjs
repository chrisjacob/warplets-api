import {BUSINESS_TABLES} from './schema.mjs';
const need=(condition,message)=>{if(!condition)throw new TypeError(message);};
/** Dependency order is retained verbatim; only its table-name representation
 * changes. The inventory is the exact sorted, schema-pinned business inventory. */
export function recoveryTableOrderIndices(value,tableNames){
 need(Array.isArray(tableNames)&&tableNames.length===BUSINESS_TABLES.length&&tableNames.every((name,index)=>name===BUSINESS_TABLES[index]),'Private v2 table-order inventory invalid.');
 need(Array.isArray(value)&&value.length===tableNames.length,'Private v2 table order incomplete.');
 const legacy=value.every(item=>typeof item==='string');
 need(legacy||value.every(item=>Number.isSafeInteger(item)),'Private v2 mixed or invalid table-order indices.');
 const indices=legacy?value.map(name=>tableNames.indexOf(name)):[...value];
 need(indices.every(index=>index>=0&&index<tableNames.length)&&new Set(indices).size===tableNames.length,'Private v2 missing, duplicate or invalid table-order entry.');
 return indices;
}
export function recoveryTableOrderPosition(value,tableNames,tableIndex){
 const indices=recoveryTableOrderIndices(value,tableNames);
 need(Number.isSafeInteger(tableIndex)&&tableIndex>=0&&tableIndex<=indices.length,'Private v2 table import index invalid.');
 return {indices,name:tableIndex===indices.length?null:tableNames[indices[tableIndex]]};
}

import {validateRecoveryV2TableDescriptor} from './v2-codec.mjs';
const fields=['name','columns','primaryKey','hasRowid','rowCount','pages','tableDigest'];
function need(value,message){if(!value)throw new TypeError(message);}
function ordered(tables){let previous=null;for(const table of tables){validateRecoveryV2TableDescriptor(table);need(previous===null||previous<table.name,'Invalid checkpoint table ordering.');previous=table.name;}return tables;}
// Lossless private storage projection. SQL fences reconstruct the exact original
// sqlite_schema text; neither archive commitments nor acceptance limits change.
export function packRecoveryV2Descriptor(descriptor){
 need(descriptor&&Array.isArray(descriptor.schemaInventory)&&!Object.keys(descriptor).some(k=>k.startsWith('schemaInventoryPacked')),'Invalid checkpoint schema inventory.');
 const {schemaInventory,...rest}=descriptor;
 return {...rest,schemaInventoryPackedV1:schemaInventory.map(row=>{
  need(row&&Object.keys(row).sort().join(',')==='name,sql,type'&&['table','trigger'].includes(row.type)&&typeof row.name==='string'&&typeof row.sql==='string','Invalid checkpoint schema row.');
  const prefix='CREATE TABLE '+row.name,short=row.type==='table'&&row.sql.startsWith(prefix);
  return [row.type,row.name,short?1:0,short?row.sql.slice(prefix.length):row.sql];
 })};
}
function unpackDescriptor(descriptor){
 need(descriptor&&typeof descriptor==='object'&&!Array.isArray(descriptor),'Invalid checkpoint descriptor.');
 need(Object.keys(descriptor).every(k=>!k.startsWith('schemaInventoryPacked')||k==='schemaInventoryPackedV1'),'Unknown checkpoint schema encoding.');
 if(!Object.hasOwn(descriptor,'schemaInventoryPackedV1'))return descriptor;
 need(!Object.hasOwn(descriptor,'schemaInventory')&&Array.isArray(descriptor.schemaInventoryPackedV1),'Ambiguous checkpoint schema encoding.');
 const {schemaInventoryPackedV1,...rest}=descriptor;
 return {...rest,schemaInventory:schemaInventoryPackedV1.map(tuple=>{
  need(Array.isArray(tuple)&&tuple.length===4&&['table','trigger'].includes(tuple[0])&&typeof tuple[1]==='string'&&[0,1].includes(tuple[2])&&typeof tuple[3]==='string'&&(tuple[2]===0||tuple[0]==='table'),'Invalid checkpoint schema tuple.');
  return {type:tuple[0],name:tuple[1],sql:(tuple[2]===1?'CREATE TABLE '+tuple[1]:'')+tuple[3]};
 })};
}
// This is private continuation storage only. Archive descriptors and their
// commitments retain their original object format and exact values.
export function packRecoveryV2Tables(tables){
 need(Array.isArray(tables),'Invalid checkpoint tables.');ordered(tables);
 return tables.map(table=>fields.map(field=>table[field]));
}
export function parseRecoveryV2Checkpoint(json){
 const checkpoint=JSON.parse(json);
 need(checkpoint&&typeof checkpoint==='object'&&!Array.isArray(checkpoint),'Invalid recovery checkpoint.');
 if(checkpoint.descriptor!==undefined)checkpoint.descriptor=unpackDescriptor(checkpoint.descriptor);
 need(Object.keys(checkpoint).every(key=>!key.startsWith('tablesPacked')||key==='tablesPackedV1'),'Unknown checkpoint table encoding.');
 if(checkpoint.tablesPackedV1!=null){
  need(checkpoint.tables==null,'Ambiguous checkpoint table encoding.');
  need(Array.isArray(checkpoint.tablesPackedV1),'Invalid packed checkpoint tables.');
  const packed=checkpoint.tablesPackedV1;delete checkpoint.tablesPackedV1;
  checkpoint.tables=ordered(packed.map(tuple=>{need(Array.isArray(tuple)&&tuple.length===fields.length,'Invalid checkpoint table tuple.');return Object.fromEntries(fields.map((field,index)=>[field,tuple[index]]));}));
 }else if(checkpoint.tables!=null){need(Array.isArray(checkpoint.tables),'Invalid checkpoint tables.');ordered(checkpoint.tables);}
 return checkpoint;
}
export function packRecoveryV2CheckpointDelta(delta){
 need(!Object.keys(delta).some(key=>key.startsWith('tablesPacked')),'Invalid direct packed checkpoint patch.');
 if(!Object.hasOwn(delta,'tables'))return delta;
 return {...delta,tables:null,tablesPackedV1:delta.tables===null?null:packRecoveryV2Tables(delta.tables)};
}

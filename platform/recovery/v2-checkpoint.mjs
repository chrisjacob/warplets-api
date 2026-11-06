import {validateRecoveryV2TableDescriptor} from './v2-codec.mjs';
const fields=['name','columns','primaryKey','hasRowid','rowCount','pages','tableDigest'];
function need(value,message){if(!value)throw new TypeError(message);}
function ordered(tables){let previous=null;for(const table of tables){validateRecoveryV2TableDescriptor(table);need(previous===null||previous<table.name,'Invalid checkpoint table ordering.');previous=table.name;}return tables;}
// This is private continuation storage only. Archive descriptors and their
// commitments retain their original object format and exact values.
export function packRecoveryV2Tables(tables){
 need(Array.isArray(tables),'Invalid checkpoint tables.');ordered(tables);
 return tables.map(table=>fields.map(field=>table[field]));
}
export function parseRecoveryV2Checkpoint(json){
 const checkpoint=JSON.parse(json);
 need(checkpoint&&typeof checkpoint==='object'&&!Array.isArray(checkpoint),'Invalid recovery checkpoint.');
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

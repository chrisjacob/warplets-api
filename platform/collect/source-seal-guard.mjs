/** SQL lineage for a retained035source seal. This is a historical committed
 * intake check, not current publication/adoption authority. Alias is internal. */
export function committedCollectionSourceSealSql(alias){
 if(typeof alias!=='string'||!/^[a-z][a-z0-9_]*$/.test(alias))throw new TypeError('Invalid internal source-seal alias.');
 return `EXISTS(SELECT 1 FROM app_command_receipts sealed JOIN app_collection_records root ON root.id=${alias}.id JOIN app_command_receipts staged ON staged.operation_id=root.operation_id WHERE sealed.operation_id=${alias}.operation_id AND sealed.state='committed' AND sealed.operation_kind='collection.seal-source.v1' AND sealed.result_ref=${alias}.id AND json_extract(sealed.input_json,'$.id')=${alias}.id AND sealed.result_json=${alias}.body_json AND root.format='collection-source-v1' AND staged.state='committed' AND staged.operation_kind='collection.stage-record.v1' AND staged.result_ref=root.id AND json_extract(staged.input_json,'$.id')=root.id AND json_extract(staged.result_json,'$.size')=root.size AND json_extract(staged.result_json,'$.format')=root.format)`;
}

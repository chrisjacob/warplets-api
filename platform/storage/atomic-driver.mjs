// Internal adapter protocol. HTTP/application consumers only receive named commands.
export function measureBatch(statements) {
  const encoder=new TextEncoder();
  const parameters=Math.max(0,...statements.map(s=>s.values.length));
  const maxSqlBytes=Math.max(0,...statements.map(s=>encoder.encode(s.sql).byteLength));
  const batchBytes=encoder.encode(JSON.stringify(statements)).byteLength;
  if(parameters>100||maxSqlBytes>100000||batchBytes>256*1024)throw new RangeError('Atomic command exceeds local SQL bounds.');
  return {statements:statements.length,maxParameters:parameters,maxSqlBytes,batchBytes};
}
export const sql=(sql,...values)=>({sql,values});
export const revisions=rows=>Object.fromEntries(rows.map(r=>[r.name,String(r.revision)]));

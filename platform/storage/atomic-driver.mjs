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

export function matchesExpectedRevisions(expected,current) {
  if(!expected||typeof expected!=='object'||Array.isArray(expected)
    ||Object.entries(expected).some(([key,value])=>!['earn','source','control'].includes(key)||typeof value!=='string'||!/^(0|[1-9][0-9]*)$/.test(value)))
    throw new TypeError('Invalid expected dependency revisions.');
  return Object.entries(expected).every(([key,value])=>current[key]===value);
}

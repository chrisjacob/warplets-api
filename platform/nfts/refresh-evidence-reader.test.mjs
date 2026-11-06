import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshRepositoryFixture,REFRESH_OWNER} from './refresh-repository.fixtures.mjs';
import {createRefreshEvidenceReader} from './refresh-evidence-reader.mjs';
import {createRefreshRepository} from './refresh-repository.mjs';
test('original recorded evidence remains historical and rejects forged receipt identity/time/digests',async t=>{
 const f=await refreshRepositoryFixture(t),created=await f.create();assert.equal(created.result.kind,'committed');
 const loaded=await f.repo.read(REFRESH_OWNER,{requestId:created.result.value.requestId}),state=loaded.value.state;
 const base=async statements=>(await f.driver.batch(statements)).map(v=>v.rows),ports={read:base,artifacts:f.store,crypto:f.crypto,historicalNowMs:state.request.createdMs};
 const quote=await createRefreshEvidenceReader(ports).originals(state,f.referenceIdentity,f.quoteIdentity);assert.equal(quote.financialExecution,false);
 for(const field of ['request_digest','output_digest','business_key','result_ref','input_json','recorded_ms']){
  const read=async statements=>{const rows=await base(statements);if(statements[0].sql.includes('SELECT a.*'))for(const row of rows[0])row[field]=field==='recorded_ms'?state.request.createdMs+1:'invalid';return rows;};
  await assert.rejects(createRefreshEvidenceReader({...ports,read}).originals(state,f.referenceIdentity,f.quoteIdentity),undefined,field);
 }
 // Advancing current time does not make a post-creation reference historical.
 const read=async statements=>{const rows=await base(statements);if(statements[0].sql.includes('SELECT a.*'))for(const row of rows[0]){row.recorded_ms=state.request.createdMs+1;row.receipt_created_ms=row.recorded_ms;}return rows;};
 await assert.rejects(createRefreshEvidenceReader({...ports,read,historicalNowMs:state.request.createdMs+1000}).originals(state,f.referenceIdentity,f.quoteIdentity),/recorded-time/);
});
test('trusted composition authority fences the actual claim after its earlier session observation',async t=>{
 const f=await refreshRepositoryFixture(t);f.db.exec("CREATE TABLE fixture_sessions(token TEXT PRIMARY KEY); INSERT INTO fixture_sessions VALUES('active')");
 const command=await f.prepare(REFRESH_OWNER,'session-fence',f.createInput);let fired=false;
 const driver={...f.driver,async batch(statements){if(!fired&&statements.some(s=>s.sql.startsWith('INSERT INTO app_command_receipts'))){fired=true;f.db.exec('DELETE FROM fixture_sessions');}return f.driver.batch(statements);}};
 const repo=createRefreshRepository(driver,{...f.ports,authoritySnapshot:()=>({sql:'EXISTS(SELECT 1 FROM fixture_sessions WHERE token=?)',values:['active']})});
 assert.equal((await repo.execute(command)).kind,'conflict');assert.equal(fired,true);assert.deepEqual(f.counts(),{revisions:0,receipts:0,checkpoints:0});
 const denied=createRefreshRepository(f.driver,{...f.ports,authoritySnapshot:()=>null});assert.equal((await denied.execute(command)).code,'refresh_session_required');
});

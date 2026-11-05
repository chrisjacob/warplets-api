import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { openDatabase, transaction } from '../storage/database.mjs';
import { createApp } from '../server/application.mjs';
import { createLocalServer } from '../server/start.mjs';
import { DAY_MS } from '../domain/earn/index.mjs';
import { addCampaign, finalizeBoard, PILOT_BOARD_CAPACITY, recordAllocation, recordReview } from '../earn/workflow.mjs';
import { recordOwnership } from '../earn/components.mjs';
import { recordSamplePrice } from '../pricing/fixtures.mjs';
import { exportBoard } from '../earn/archive.mjs';
import { instrumentDatabase, logicalBudget, percentiles } from './instrument.mjs';

const epoch=20_001,start=epoch*DAY_MS+30_000,cutoff=(epoch+1)*DAY_MS-1;
const tokenId='fixture-ATT';
const wallet=n=>'participant-'+String(n).padStart(5,'0');
const token=n=>'synthetic-session-'+n;
const fingerprint=s=>createHash('sha256').update(s).digest('hex');
function databaseBytes(db) {
  return db.prepare('PRAGMA page_size').get().page_size*db.prepare('PRAGMA page_count').get().page_count;
}
function plans(db) {
  return Object.fromEntries(Object.entries({
    session:'SELECT wallet FROM sessions WHERE token_hash=? AND origin=? AND expires_at>?',
    entryEvidence:'SELECT receipt,decision,read_id FROM price_observations WHERE wallet=? AND token_id=? AND as_of_ms<=? ORDER BY as_of_ms DESC,revision DESC LIMIT 1',
    idempotency:'SELECT id FROM earn_submissions WHERE wallet=? AND request_key=?',
    boardCapacity:'SELECT admitted FROM earn_admission_counts WHERE epoch=?',
    publicBoard:'SELECT winners FROM earn_boards WHERE epoch=?',
    portfolio:'SELECT assets FROM earn_owner_snapshots WHERE epoch=? AND wallet=?',
    vestedAwards:'SELECT amount FROM earn_awards WHERE wallet=? AND rowid>? ORDER BY rowid LIMIT 51',
  }).map(([key,sql])=>[key,db.prepare('EXPLAIN QUERY PLAN '+sql).all(...Array((sql.match(/\?/g)||[]).length).fill(1)).map(r=>r.detail)]));
}
export async function runLoad(contributors) {
  assert.ok(Number.isInteger(contributors)&&contributors>=1&&contributors<=10_000);
  const db=openDatabase();const {db:counted,metrics}=instrumentDatabase(db);
  const server=createLocalServer(createApp(counted,{clock:()=>start}));
  try {
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const origin='http://127.0.0.1:'+server.address().port;
    const emptyBytes=databaseBytes(db),acceptedExpected=Math.min(PILOT_BOARD_CAPACITY,contributors);
    transaction(db,()=>{
      addCampaign(db,{tokenId,activationMs:start,originalUnits:'1000000000'});
      const save=db.prepare('INSERT INTO sessions VALUES(?,?,?,?)');
      for(let i=0;i<contributors;i++) save.run(fingerprint(token(i)),wallet(i),origin,start+3*DAY_MS);
      for(let i=0;i<acceptedExpected;i++) recordSamplePrice(db,{tokenId,wallet:wallet(i),asOfMs:start,stakedUnits:'10000000'});
    });
    const fixtureBytes=databaseBytes(db)-emptyBytes;
    const changes=()=>db.prepare('SELECT total_changes() AS n').get().n;
    const beforeIngress=changes();
    const elapsed=[], admitted=[],counts={accepted:0,capacity:0};
    const began=performance.now();
    // One sequential real loopback request per contributor, no production network
    // or fake RPC latency. A separate multi-connection probe covers writer races.
    for(let i=0;i<contributors;i++) {
      const at=performance.now();
      const response=await fetch(origin+'/api/v1/earn/submissions',{method:'POST',headers:{origin,
        cookie:'tenx_local_session='+token(i),'content-type':'application/json','idempotency-key':'first'},
        body:JSON.stringify({tokenId,url:'https://example.org/content/'+i})});
      const body=await response.json();elapsed.push(performance.now()-at);
      if (response.status===201) {counts.accepted++;admitted.push([wallet(i),body.id]);}
      else {assert.equal(response.status,409);assert.equal(body.error.code,'board_capacity');counts.capacity++;}
    }
    const httpMs=performance.now()-began,ingressMetrics={...metrics};
    ingressMetrics.sqliteChangedRows=changes()-beforeIngress;
    assert.equal(admitted.length,acceptedExpected);
    const paidAt=performance.now();
    transaction(db,()=>{
      for (const [owner,id] of admitted) {
        recordReview(db,{submissionId:id,score:7,reason:'Fixture',moderator:'local',sourceRef:'review:'+id,reviewedMs:start+1});
        recordOwnership(db,{epoch,wallet:owner,asOfMs:cutoff,assets:[],sourceRef:'empty:'+owner});
        recordSamplePrice(db,{tokenId,wallet:owner,asOfMs:cutoff,stakedUnits:'10000000'});
      }
    });
    const reviewedMs=performance.now()-paidAt;
    const beforeSettlement=changes();
    const settledAt=performance.now();
    const board=finalizeBoard(counted,{epoch,nowMs:cutoff+1,sourceComplete:true,sourceRef:'synthetic-complete'});
    assert.equal(board.items.length,acceptedExpected);
    recordAllocation(counted,{tokenId,day:2,nowMs:start+DAY_MS});
    const bundle=exportBoard(counted,epoch);
    assert.equal(bundle.manifest.allocations.length,1);
    const settlementMs=performance.now()-settledAt;
    return {contributors,counts,latencyMs:percentiles(elapsed),httpElapsedMs:Number(httpMs.toFixed(2)),
      sequentialRequestsPerSecond:Number((contributors*1000/httpMs).toFixed(1)),ingressMetrics,
      fixtureSeedBytes:fixtureBytes,wholeRunDatabaseGrowth:databaseBytes(db)-emptyBytes,
      reviewFixtureSetupMs:Number(reviewedMs.toFixed(2)),finalizeAllocateExportMs:Number(settlementMs.toFixed(2)),
      settlementMetrics:{...Object.fromEntries(Object.entries(metrics).map(([key,v])=>[key,v-ingressMetrics[key]])),
        sqliteChangedRows:changes()-beforeSettlement},
      manifestBytes:Buffer.byteLength(JSON.stringify(bundle)),plans:plans(db),budget:logicalBudget(contributors,admitted.length)};
  } finally {
    if(server.listening) {const closed=once(server,'close');server.close();server.closeAllConnections();await closed;}
    db.close();
  }
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const samples=process.argv.slice(2).length?process.argv.slice(2).map(Number):[100,1000,10000];
  const report={mode:'local-loopback-only',node:process.version,platform:process.platform,arch:process.arch,
    reviewCapacity:PILOT_BOARD_CAPACITY,scenarios:[]};
  for(const n of samples) report.scenarios.push(await runLoad(n));
  console.log(JSON.stringify(report,null,2));
}

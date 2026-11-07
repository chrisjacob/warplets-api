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
import { configureWorkload } from '../earn/operations.mjs';
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
export async function runLoad(contributors,{campaignCount=1,staffedMinutes=null}={}) {
  assert.ok(Number.isInteger(contributors)&&contributors>=1&&contributors<=10_000);
  assert.ok(campaignCount===1||campaignCount===10);
  assert.ok(staffedMinutes===null||(Number.isInteger(staffedMinutes)&&staffedMinutes>=0&&staffedMinutes<=300));
  const now=campaignCount===1?start:epoch*DAY_MS+14*3600000+30000;
  // Ten Sydney dates in nine UTC dates: preserves existing day-1..10 allocation
  // policy without silently inventing the still-unratified day-eleven mapping.
  const campaigns=Array.from({length:campaignCount},(_,i)=>({tokenId:campaignCount===1?tokenId:tokenId+'-'+i,
    activationMs:campaignCount===1?start:epoch*DAY_MS-(i===9?8:i)*DAY_MS+(i===9?12:14)*3600000}));
  const campaignAt=i=>campaigns[i%campaignCount];
  const sydneyDate=new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'});
  assert.equal(new Set(campaigns.map(c=>sydneyDate.format(c.activationMs))).size,campaignCount);
  for(const c of campaigns){assert.ok(c.activationMs<=now&&now<c.activationMs+10*DAY_MS);const day=epoch-Math.floor(c.activationMs/DAY_MS)+2;assert.ok(day>=1&&day<=10);}
  const memory={baseline:process.memoryUsage(),sampledPeak:{},samples:0};
  const sampleMemory=()=>{memory.samples++;for(const [key,value] of Object.entries(process.memoryUsage()))memory.sampledPeak[key]=Math.max(memory.sampledPeak[key]??0,value);};
  sampleMemory();
  const db=openDatabase();const {db:counted,metrics}=instrumentDatabase(db);
  const server=createLocalServer(createApp(counted,{clock:()=>now}));
  try {
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const origin='http://127.0.0.1:'+server.address().port;
    const emptyBytes=databaseBytes(db),limit=staffedMinutes===null?PILOT_BOARD_CAPACITY:Math.min(PILOT_BOARD_CAPACITY,Math.floor(staffedMinutes/3)),acceptedExpected=Math.min(limit,contributors);
    transaction(db,()=>{
      for(const campaign of campaigns)addCampaign(db,{...campaign,originalUnits:'1000000000'});
      configureWorkload(db,{effectiveEpoch:epoch,atMs:now,staffedMinutes:staffedMinutes??300,secondsPerReview:180,admissionLimit:PILOT_BOARD_CAPACITY,operator:'synthetic-load',reason:'explicit-staffing-fixture'});
      const save=db.prepare('INSERT INTO sessions VALUES(?,?,?,?)');
      for(let i=0;i<contributors;i++) save.run(fingerprint(token(i)),wallet(i),origin,start+3*DAY_MS);
      for(let i=0;i<acceptedExpected;i++) recordSamplePrice(db,{tokenId:campaignAt(i).tokenId,wallet:wallet(i),asOfMs:now,stakedUnits:'10000000'});
    });
    const fixtureBytes=databaseBytes(db)-emptyBytes;
    const changes=()=>db.prepare('SELECT total_changes() AS n').get().n;
    const beforeIngress=changes();
    sampleMemory();
    const elapsed=[], admitted=[],counts={accepted:0,capacity:0},maxIngressRequest={statements:0,rowsReturned:0,rowsChanged:0};
    const byCampaign=Object.fromEntries(campaigns.map(c=>[c.tokenId,{attempts:0,accepted:0,capacity:0}]));
    const began=performance.now();
    // One sequential real loopback request per contributor, no production network
    // or fake RPC latency. A separate multi-connection probe covers writer races.
    for(let i=0;i<contributors;i++) {
      const at=performance.now();
      const before={...metrics},selected=campaignAt(i).tokenId;byCampaign[selected].attempts++;
      const response=await fetch(origin+'/api/v1/earn/submissions',{method:'POST',headers:{origin,
        cookie:'tenx_local_session='+token(i),'content-type':'application/json','idempotency-key':'first'},
        body:JSON.stringify({tokenId:selected,url:'https://example.org/content/'+i})});
      const body=await response.json();elapsed.push(performance.now()-at);
      if (response.status===201) {counts.accepted++;byCampaign[selected].accepted++;admitted.push([wallet(i),body.id,selected]);}
      else {assert.equal(response.status,409,JSON.stringify({attempt:i,body}));assert.equal(body.error.code,'board_capacity');counts.capacity++;byCampaign[selected].capacity++;}
      for(const key of Object.keys(maxIngressRequest))maxIngressRequest[key]=Math.max(maxIngressRequest[key],metrics[key]-before[key]);
      sampleMemory();
    }
    const httpMs=performance.now()-began,ingressMetrics={...metrics};
    ingressMetrics.sqliteChangedRows=changes()-beforeIngress;
    assert.equal(admitted.length,acceptedExpected);
    const paidAt=performance.now();
    transaction(db,()=>{
      for (const [owner,id,selected] of admitted) {
        recordReview(db,{submissionId:id,score:7,reason:'Fixture',moderator:'local',sourceRef:'review:'+id,reviewedMs:now+1});
        recordOwnership(db,{epoch,wallet:owner,asOfMs:cutoff,assets:[],sourceRef:'empty:'+owner});
        recordSamplePrice(db,{tokenId:selected,wallet:owner,asOfMs:cutoff,stakedUnits:'10000000'});
      }
    });
    const reviewedMs=performance.now()-paidAt;
    const beforeSettlement=changes();
    const settledAt=performance.now();
    const held=finalizeBoard(counted,{epoch,nowMs:cutoff+1,sourceComplete:false,sourceRef:'synthetic-incomplete'});
    assert.equal(held.status,'pending');assert.equal(held.reason,'incomplete-source');
    const board=finalizeBoard(counted,{epoch,nowMs:cutoff+1,sourceComplete:true,sourceRef:'synthetic-complete'});
    assert.equal(board.items.length,acceptedExpected);
    for(const campaign of campaigns)recordAllocation(counted,{tokenId:campaign.tokenId,day:epoch-Math.floor(campaign.activationMs/DAY_MS)+2,nowMs:now+DAY_MS});
    const bundle=exportBoard(counted,epoch);
    assert.equal(bundle.manifest.allocations.length,campaignCount);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM earn_boards').get().n,1);
    sampleMemory();
    const settlementMs=performance.now()-settledAt;
    return {contributors,campaignCount,campaigns,byCampaign,globalAdmissionLimit:limit,counts,errorStates:{board_capacity:counts.capacity,incompleteSourceHeld:true,unexpected:0},maxIngressRequest,memory,
      adapter:'node-sqlite-loopback',financialExecution:false,providerCalls:0,
      artifactBytes:{aggregate:Buffer.byteLength(JSON.stringify(bundle)),allocations:bundle.manifest.allocations.map(a=>({tokenId:a.tokenId,bytes:Buffer.byteLength(JSON.stringify(a))}))},
      latencyMs:percentiles(elapsed),httpElapsedMs:Number(httpMs.toFixed(2)),
      sequentialRequestsPerSecond:Number((contributors*1000/httpMs).toFixed(1)),ingressMetrics,
      fixtureSeedBytes:fixtureBytes,wholeRunDatabaseGrowth:databaseBytes(db)-emptyBytes,
      reviewFixtureSetupMs:Number(reviewedMs.toFixed(2)),finalizeAllocateExportMs:Number(settlementMs.toFixed(2)),
      settlementMetrics:{...Object.fromEntries(Object.entries(metrics).map(([key,v])=>[key,v-ingressMetrics[key]])),
        sqliteChangedRows:changes()-beforeSettlement},
      manifestBytes:Buffer.byteLength(JSON.stringify(bundle)),plans:plans(db),budget:logicalBudget(contributors,admitted.length,campaignCount)};
  } finally {
    if(server.listening) {const closed=once(server,'close');server.close();server.closeAllConnections();await closed;}
    db.close();
  }
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const full=process.argv.includes('--full'),samples=full?[1000]:(process.argv.slice(2).length?process.argv.slice(2).map(Number):[100,1000,10000]);
  const report={mode:'local-loopback-only',node:process.version,platform:process.platform,arch:process.arch,
    reviewCapacity:PILOT_BOARD_CAPACITY,scenarios:[]};
  for(const n of samples) report.scenarios.push(await runLoad(n));
  if(full){report.scenarios.push(await runLoad(1000,{campaignCount:10}));report.scenarios.push(await runLoad(1000,{campaignCount:10,staffedMinutes:60}));}
  console.log(JSON.stringify(report,null,2));
}

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { openDatabase } from '../storage/database.mjs';
import { DAY_MS } from '../domain/earn/index.mjs';
import { addCampaign, finalizeBoard, recordAllocation, recordReview, submitContent } from '../earn/workflow.mjs';
import { recordOwnership } from '../earn/components.mjs';
import { exportBoard } from '../earn/archive.mjs';
import { recordSamplePrice } from '../pricing/fixtures.mjs';

const epoch=20_100,start=epoch*DAY_MS,cutoff=(epoch+1)*DAY_MS-1, wallet='fixture-owner',tokenId='fixture-ATT';
function operation(db,{step,postId}) {
  const submit={wallet,tokenId,url:'https://example.org/article',requestKey:'shared',nowMs:start};
  switch(step) {
    case 'submit': return submitContent(db,submit);
    case 'review': return recordReview(db,{submissionId:postId,score:8,reason:'Fixture',sourceRef:'moderation',
      reviewedMs:start+100,moderator:'operator'});
    case 'finalize': return finalizeBoard(db,{epoch,nowMs:cutoff+1,sourceComplete:true,sourceRef:'fixture-reconciled'});
    case 'allocate': return recordAllocation(db,{tokenId,day:2,nowMs:start+DAY_MS});
    default: throw new Error('Unknown phase');
  }
}
if (!isMainThread) {
  const db=openDatabase(workerData.path);
  parentPort.on('message',msg=>{
    try {parentPort.postMessage({result:operation(db,msg)});}
    catch(error){parentPort.postMessage({error:error.message});}
  });
  parentPort.postMessage({ready:true});
}
function next(worker) {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>done(reject,new Error('Timed out waiting for local writer')),30_000);
    const message=x=>done(x.error?reject:resolve,x.error?new Error(x.error):x);
    const error=e=>done(reject,e);
    function done(fn,value) {
      clearTimeout(timer);worker.off('message',message);worker.off('error',error);fn(value);
    }
    worker.once('message',message);worker.once('error',error);
  });
}
export async function runWriterRace(writers=4) {
  assert.ok(Number.isInteger(writers)&&writers>=2&&writers<=8);
  const directory=mkdtempSync(join(tmpdir(),'10x-earn-race-')),path=join(directory,'fixture.sqlite');
  const workers=[];
  let db=openDatabase(path);
  try {
    addCampaign(db,{tokenId,activationMs:start,originalUnits:'100000'});
    recordSamplePrice(db,{tokenId,wallet,asOfMs:start,stakedUnits:'10000000'});
    recordSamplePrice(db,{tokenId,wallet,asOfMs:cutoff,stakedUnits:'10000000'});
    recordOwnership(db,{wallet,epoch,asOfMs:cutoff,assets:[],sourceRef:'empty'});
    await Promise.all(Array.from({length:writers},async()=>{
      const w=new Worker(new URL(import.meta.url),{workerData:{path}});workers.push(w);
      assert.equal((await next(w)).ready,true);
    }));
    const race=step=>Promise.all(workers.map(async w=>{
      const reply=next(w);w.postMessage(step);return (await reply).result;
    }));
    const submissions=await race({step:'submit'});
    assert.equal(submissions.filter(s=>!s.replay).length,1);
    const ids=new Set(submissions.map(s=>s.submission.id));assert.equal(ids.size,1);
    await race({step:'review',postId:[...ids][0]});
    const boards=await race({step:'finalize'});
    assert.ok(boards.every(b=>b.snapshotId===boards[0].snapshotId&&b.status==='final'));
    const plans=await race({step:'allocate'});
    assert.ok(plans.every(p=>p.status==='recorded'));
    const counts={};
    for(const table of ['submissions','reviews','boards','decisions','allocations','awards']) {
      counts[table]=db.prepare('SELECT count(*) AS n FROM earn_'+table).get().n;
      assert.equal(counts[table],1);
    }
    const before=exportBoard(db,epoch).sha256;
    db.close();db=openDatabase(path);
    assert.equal(exportBoard(db,epoch).sha256,before);
    return {writers,operations:writers*4,counts,identicalAfterReopen:true};
  } finally {
    await Promise.allSettled(workers.map(w=>w.terminate()));
    db.close();rmSync(directory,{recursive:true,force:true});
  }
}
if (isMainThread && process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await runWriterRace(),null,2));
}

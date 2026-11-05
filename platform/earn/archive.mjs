import { transaction } from '../storage/database.mjs';
import { claimableUnits } from '../domain/earn/index.mjs';
import { EarnError, conflict, nat } from './checks.mjs';
import { FORMAT, allocationContext, awardRoot, commitment, makeAwardProof, verifyManifest } from './commitments.mjs';

export function recoveryMode(db) {
  return Boolean(db.prepare('SELECT 1 FROM earn_recovered_boards LIMIT 1').get());
}
function readLiveBoard(db,epoch) {
  const b=db.prepare('SELECT * FROM earn_boards WHERE epoch=?').get(epoch);
  if (!b) return null;
  const board={epoch,finalizedAtMs:b.finalized_ms,snapshotId:b.snapshot_hash,winners:JSON.parse(b.winners)};
  const boardId=commitment('board',board);
  const rows=db.prepare(`SELECT a.*,c.activation_ms,c.original_units FROM earn_allocations a
    JOIN earn_fixture_campaigns c ON c.token_id=a.token_id WHERE a.epoch=? ORDER BY a.token_id`).all(epoch);
  const byWallet=db.prepare('SELECT wallet,amount FROM earn_awards WHERE token_id=? AND day=?');
  const allocations=rows.map(row=>{
    const amounts=new Map(byWallet.all(row.token_id,row.day).map(a=>[a.wallet,a.amount]));
    if (amounts.size!==board.winners.length) conflict('reconciliation_failed','Recorded award count differs from the board.');
    const awards=board.winners.map(w=>{
      if (!amounts.has(w.wallet)) conflict('reconciliation_failed','Winner missing its recorded award.');
      return {wallet:w.wallet,amountUnits:amounts.get(w.wallet)};
    });
    const a={boardId,tokenId:row.token_id,day:row.day,activationMs:row.activation_ms,originalUnits:row.original_units,
      startsAtMs:row.starts_ms,vestsFromMs:row.vests_from_ms,vestsThroughMs:row.vests_through_ms,
      budgetUnits:row.budget,burnUnits:row.burn,awards};
    return {...a,awardRoot:awardRoot(allocationContext(a),a.awards)};
  });
  return {format:FORMAT,board,boardId,allocations};
}
function readRecoveredBoard(db,epoch) {
  const b=db.prepare('SELECT * FROM earn_recovered_boards WHERE epoch=?').get(epoch);
  if (!b) return null;
  const allocations=db.prepare('SELECT allocation_json FROM earn_recovered_allocations WHERE epoch=? ORDER BY token_id').all(epoch);
  return {format:FORMAT,board:JSON.parse(b.board_json),boardId:b.board_id,allocations:allocations.map(a=>JSON.parse(a.allocation_json))};
}
export function exportBoard(db,epoch) {
  nat(epoch,'epoch');
  const manifest=transaction(db,()=>recoveryMode(db) ? readRecoveredBoard(db,epoch) : readLiveBoard(db,epoch));
  if (!manifest) throw new EarnError(409,'board_unfinalized','Publish the board before exporting.');
  const sha256=commitment('manifest',manifest);
  verifyManifest(manifest,sha256);
  return {sha256,manifest};
}
export function proofForWallet(db,{wallet,tokenId,day}) {
  const lookup=recoveryMode(db)?'earn_recovered_allocations':'earn_allocations';
  const row=db.prepare('SELECT epoch FROM '+lookup+' WHERE token_id=? AND day=?').get(tokenId,day);
  if (!row) throw new EarnError(404,'unknown_allocation','Allocation not yet recorded.');
  const bundle=exportBoard(db,row.epoch);
  const allocation=bundle.manifest.allocations.find(a=>a.tokenId===tokenId && a.day===day);
  const proof=makeAwardProof(allocation,wallet);
  if (!proof) throw new EarnError(404,'no_award','Wallet has no award in this allocation.');
  return {mode:'local-fixture',manifestDigest:bundle.sha256,proof};
}

export function importBoard(db,manifest,pinnedDigest) {
  const verified=verifyManifest(manifest,pinnedDigest);
  return transaction(db,()=>{
    if (db.prepare('SELECT 1 FROM earn_fixture_campaigns LIMIT 1').get() || db.prepare('SELECT 1 FROM earn_boards LIMIT 1').get()) {
      conflict('use_recovery_database','Import public awards into a separate recovery database.');
    }
    const {board,boardId}=manifest;
    const existing=db.prepare('SELECT board_id FROM earn_recovered_boards WHERE epoch=?').get(board.epoch);
    if (existing && existing.board_id!==boardId) conflict('archive_conflict','A different board is pinned for that day.');
    if (!existing) db.prepare('INSERT INTO earn_recovered_boards VALUES(?,?,?)').run(board.epoch,boardId,JSON.stringify(board));
    let added=0;
    for (const allocation of manifest.allocations) {
      const allocationId=commitment('allocation',allocation);
      const old=db.prepare('SELECT allocation_id FROM earn_recovered_allocations WHERE token_id=? AND day=?').get(allocation.tokenId,allocation.day);
      if (old && old.allocation_id!==allocationId) conflict('archive_conflict','A different allocation is pinned for that token/day.');
      if (old) continue;
      db.prepare('INSERT INTO earn_recovered_allocations VALUES(?,?,?,?,?)').run(allocation.tokenId,allocation.day,board.epoch,allocationId,JSON.stringify(allocation));
      const save=db.prepare('INSERT INTO earn_recovered_awards VALUES(?,?,?,?,?,?)');
      for (const a of allocation.awards) save.run(a.wallet,allocation.tokenId,allocation.day,a.amountUnits,allocation.vestsFromMs,allocation.vestsThroughMs);
      added++;
    }
    return {...verified,addedAllocations:added};
  });
}
export function readRecoveredLeaderboard(db,epoch) {
  const data=readRecoveredBoard(db,epoch);
  const date=new Date(epoch*86_400_000).toISOString().slice(0,10);
  if (!data) return {mode:'local-fixture',source:'public-archive',epoch,date,status:'pending',items:[],allocations:[],snapshotId:null,finalizedAtMs:null};
  return {mode:'local-fixture',source:'public-archive',epoch,date,status:'final',snapshotId:data.board.snapshotId,
    finalizedAtMs:data.board.finalizedAtMs,items:data.board.winners.map((w,i)=>({rank:i+1,...w})),
    allocations:data.allocations.map(({tokenId,day,budgetUnits,burnUnits,vestsFromMs,vestsThroughMs})=>
      ({tokenId,day,budgetUnits,burnUnits,vestsFromMs,vestsThroughMs}))};
}
export function readRecoveredClaims(db,{wallet,nowMs,after}) {
  const rows=db.prepare(`SELECT rowid AS cursor,token_id AS tokenId,day,amount AS awardUnits,
    vests_from_ms AS vestsFromMs,vests_through_ms AS vestsThroughMs FROM earn_recovered_awards
    WHERE wallet=? AND rowid>? ORDER BY rowid LIMIT 51`).all(wallet,after);
  const items=rows.slice(0,50).map(({cursor,...row})=>({...row,vestedUnits:String(claimableUnits({
    awardedUnits:BigInt(row.awardUnits),claimedUnits:0n,window:row,nowMs}))}));
  return {mode:'local-fixture',source:'public-archive',executionEnabled:false,items,nextCursor:rows.length>50?rows[49].cursor:null};
}

import { DAY_MS, applyPurchaseActivity, enrollPosition, epochAt, snapshotPurchasePosition } from '../domain/earn/index.mjs';
import { transaction } from '../storage/database.mjs';
import { conflict, decimal, name, nat, requireValue } from './checks.mjs';
import { observationAt } from '../pricing/evidence.mjs';

export function registerPosition(db,{wallet,tokenId,enrolledMs}) {
  name(wallet,'wallet');name(tokenId,'token');nat(enrolledMs,'enrollment');
  const epoch=epochAt(enrolledMs);
  return transaction(db,()=>{
    const current=db.prepare('SELECT * FROM earn_position_enrollments WHERE wallet=? AND token_id=?').get(wallet,tokenId);
    if (current) {
      if (current.enrolled_ms!==enrolledMs) conflict('enrollment_conflict','This position has an enrollment checkpoint.');
      return {wallet,tokenId,enrolledMs};
    }
    if (db.prepare('SELECT 1 FROM earn_boards WHERE epoch>=? LIMIT 1').get(epoch)) conflict('board_closed','Enrollment is prospective.');
    const campaign=db.prepare('SELECT activation_ms FROM earn_fixture_campaigns WHERE token_id=?').get(tokenId);
    requireValue(campaign && enrolledMs>=campaign.activation_ms && enrolledMs<campaign.activation_ms+10*DAY_MS,'Enroll during an active ATT campaign.');
    db.prepare('INSERT INTO earn_position_enrollments VALUES(?,?,?)').run(wallet,tokenId,enrolledMs);
    return {wallet,tokenId,enrolledMs};
  });
}

function normalizeEvent(input) {
  const {type,signature,instructionIndex,wallet,tokenId,sequence,atMs,sourceRef}=input;
  name(signature,'signature');nat(instructionIndex,'instruction index');name(wallet,'wallet');name(tokenId,'token');
  name(sourceRef,'journal evidence');nat(atMs,'event time');
  requireValue(Number.isSafeInteger(sequence)&&sequence>=1,'Event sequence starts at 1.');
  requireValue(input.confirmed===true,'Require a verified confirmed fixture transaction.');
  const common={type,signature,instructionIndex,wallet,tokenId,sequence,atMs,sourceRef,confirmed:true};
  if (type==='verified-buy-and-stake') {
    const {swap,deposit}=input;
    requireValue(swap && deposit && swap.wallet===wallet && deposit.wallet===wallet && swap.tokenId===tokenId && deposit.tokenId===tokenId
      && swap.signature===signature && deposit.signature===signature,'Purchase and deposit must share wallet, token and transaction.');
    requireValue(Number.isSafeInteger(swap.instructionIndex) && swap.instructionIndex>=0 && swap.instructionIndex<instructionIndex
      && deposit.instructionIndex===instructionIndex,'Require ordered swap and deposit instruction evidence.');
    const bought=decimal(swap.netBoughtUnits,'net bought');const deposited=decimal(deposit.depositedUnits,'deposited');
    requireValue(bought>0n&&deposited>0n,'Purchase and deposit must both be positive.');
    return {...common,swapIndex:swap.instructionIndex,netBoughtUnits:String(bought),depositedUnits:String(deposited)};
  }
  if (type==='withdrawal') {
    return {...common,withdrawnUnits:String(decimal(input.withdrawnUnits,'withdrawn')),
      remainingStakeUnits:String(decimal(input.remainingStakeUnits,'remaining stake'))};
  }
  requireValue(['deposit','reward','restake','exit','position-transfer'].includes(type),'Unsupported farm event.');
  return common;
}
export function recordPositionEvent(db,input) {
  const e=normalizeEvent(input);
  const encoded=JSON.stringify(e);
  return transaction(db,()=>{
    const prior=db.prepare('SELECT evidence FROM earn_position_events WHERE wallet=? AND token_id=? AND signature=? AND instruction_idx=?')
      .get(e.wallet,e.tokenId,e.signature,e.instructionIndex);
    if (prior) {
      if (prior.evidence!==encoded) conflict('event_conflict','Signature/instruction already indexes different evidence.');
      return {sequence:e.sequence};
    }
    if (e.type==='verified-buy-and-stake' && db.prepare("SELECT 1 FROM earn_position_events WHERE wallet=? AND token_id=? AND signature=? AND kind='verified-buy-and-stake'")
      .get(e.wallet,e.tokenId,e.signature)) conflict('duplicate_purchase','Pilot credits at most one linked purchase per token and transaction.');
    const enrolled=db.prepare('SELECT enrolled_ms FROM earn_position_enrollments WHERE wallet=? AND token_id=?').get(e.wallet,e.tokenId);
    requireValue(enrolled && e.atMs>=enrolled.enrolled_ms,'Event precedes position enrollment.');
    const last=db.prepare('SELECT seq,at_ms FROM earn_position_events WHERE wallet=? AND token_id=? ORDER BY seq DESC LIMIT 1').get(e.wallet,e.tokenId);
    if ((last?.seq??0)+1!==e.sequence || e.atMs<(last?.at_ms??0)) conflict('journal_gap','Append confirmed position events in order without gaps.');
    if (db.prepare('SELECT 1 FROM earn_position_cutoffs WHERE wallet=? AND token_id=? AND epoch>=? LIMIT 1')
      .get(e.wallet,e.tokenId,epochAt(e.atMs))) conflict('position_sealed','Position already reconciled through that event.');
    db.prepare('INSERT INTO earn_position_events VALUES(?,?,?,?,?,?,?,?)').run(e.wallet,e.tokenId,e.sequence,e.atMs,e.signature,e.instructionIndex,e.type,encoded);
    return {sequence:e.sequence};
  });
}
function decodeFarmEvent(payload) {
  const e=JSON.parse(payload);
  for (const field of ['netBoughtUnits','depositedUnits','withdrawnUnits','remainingStakeUnits']) {
    if (Object.hasOwn(e,field)) e[field]=BigInt(e[field]);
  }
  return e;
}

export function reconcilePosition(db,{epoch,wallet,tokenId,asOfMs,reconciledSequence,stakedUnits,
  priceNumerator,priceDenominator,sourceRef}) {
  nat(epoch,'epoch');name(wallet,'wallet');name(tokenId,'token');name(sourceRef,'farm checkpoint');nat(reconciledSequence,'confirmed sequence');
  const cutoff=(epoch+1)*DAY_MS-1;
  requireValue(asOfMs===cutoff,'Position and price checkpoint must match the UTC cutoff.');
  return transaction(db,()=>{
    const evidence=observationAt(db,wallet,tokenId,cutoff);
    if (evidence.status!=='verified') return {status:'pending',reason:evidence.reason,epoch,wallet,tokenId};
    requireValue((stakedUnits===undefined||stakedUnits===evidence.stakedUnits)
      &&(priceNumerator===undefined||priceNumerator===evidence.priceNumerator)
      &&(priceDenominator===undefined||priceDenominator===evidence.priceDenominator),'Position price/units must match the verified checkpoint.');
    stakedUnits=evidence.stakedUnits;priceNumerator=evidence.priceNumerator;priceDenominator=evidence.priceDenominator;
    const stake=BigInt(stakedUnits),numerator=BigInt(priceNumerator),denominator=BigInt(priceDenominator);
    sourceRef=sourceRef+' / '+evidence.receipt;
    const stored=db.prepare('SELECT * FROM earn_position_cutoffs WHERE wallet=? AND token_id=? AND epoch=?').get(wallet,tokenId,epoch);
    if (stored) {
      if (stored.sequence!==reconciledSequence || stored.stake!==stakedUnits || stored.numerator!==priceNumerator ||
          stored.denominator!==priceDenominator || stored.source_ref!==sourceRef) conflict('position_sealed','Position checkpoint already recorded.');
      return {epoch,wallet,tokenId,tokenDays:stored.token_days};
    }
    const enrollment=db.prepare('SELECT * FROM earn_position_enrollments WHERE wallet=? AND token_id=?').get(wallet,tokenId);
    requireValue(enrollment && enrollment.enrolled_ms<=cutoff,'Position not enrolled at cutoff.');
    const campaign=db.prepare('SELECT activation_ms FROM earn_fixture_campaigns WHERE token_id=?').get(tokenId);
    const previous=db.prepare('SELECT * FROM earn_position_cutoffs WHERE wallet=? AND token_id=? ORDER BY epoch DESC LIMIT 1').get(wallet,tokenId);
    const expectedEpoch=previous ? previous.epoch+1 : epochAt(enrollment.enrolled_ms);
    if (epoch!==expectedEpoch) conflict('missing_position_checkpoint','Reconcile each enrolled position chronologically.');
    const lastSeq=db.prepare('SELECT seq FROM earn_position_events WHERE wallet=? AND token_id=? AND at_ms<=? ORDER BY seq DESC LIMIT 1')
      .get(wallet,tokenId,cutoff)?.seq??0;
    if (lastSeq!==reconciledSequence) conflict('journal_gap','Confirmed sequence does not match imported farm activity.');
    let position=enrollPosition(wallet,tokenId);
    if (previous) position={...position,sequence:previous.sequence,creditedUnits:BigInt(previous.credited),
      flags:JSON.parse(previous.flags),lastEpoch:previous.epoch};
    const events=db.prepare('SELECT evidence FROM earn_position_events WHERE wallet=? AND token_id=? AND seq>? AND seq<=? ORDER BY seq')
      .iterate(wallet,tokenId,position.sequence,lastSeq);
    for (const row of events) position=applyPurchaseActivity(position,decodeFarmEvent(row.evidence));
    const active=campaign.activation_ms<=cutoff && cutoff<campaign.activation_ms+10*DAY_MS;
    const result=snapshotPurchasePosition(position,{epoch,active,reconciledSequence,stakedUnits:stake,
      priceNumerator:numerator,priceDenominator:denominator});
    requireValue(result.status==='ready','Position evidence incomplete.');
    db.prepare('INSERT INTO earn_position_cutoffs VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(epoch,wallet,tokenId,lastSeq,
      String(result.position.creditedUnits),stakedUnits,priceNumerator,priceDenominator,JSON.stringify(result.position.flags),result.tokenDays,sourceRef);
    return {epoch,wallet,tokenId,tokenDays:result.tokenDays};
  });
}

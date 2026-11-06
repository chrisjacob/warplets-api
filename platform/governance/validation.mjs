import {NOTICE_MS} from '../domain/collections/ballot.mjs';
export function validBallotContext(row){
 return !!row&&typeof row.id==='string'&&/^[a-z0-9][a-z0-9-]{0,63}$/.test(row.id)&&/^[a-f0-9]{64}$/.test(row.snapshot_hash)&&
  [row.opens_ms,row.closes_ms,row.tranche_open_ms].every(ms=>Number.isSafeInteger(ms)&&ms>=0&&ms<=8640000000000000)&&
  row.opens_ms>=row.tranche_open_ms&&row.closes_ms===row.opens_ms+NOTICE_MS&&Number.isInteger(row.eligible_count)&&row.eligible_count>=0&&row.eligible_count<=10000;
}

// Stored observations are not sufficient alone: the linked stake row must
// describe this wallet/token at the same point with the same valuation/TTL.
export function admissionRead(row,{wallet,tokenId,nowMs}){
 let value;try{value=typeof row?.decision==='string'&&new TextEncoder().encode(row.decision).length<=256*1024?JSON.parse(row.decision):null;}catch{}
 if(!row?.id||value?.status!=='verified'||row.read_wallet!==wallet||row.read_token!==tokenId||
  !Number.isSafeInteger(row.as_of_ms)||row.as_of_ms<0||row.as_of_ms>nowMs||row.read_observed_ms!==row.as_of_ms||
  !Number.isSafeInteger(value.expiresMs)||value.expiresMs<nowMs||row.read_expires_ms!==value.expiresMs||
  typeof value.microUsd!=='string'||!/^(0|[1-9][0-9]{0,159})$/.test(value.microUsd)||row.micro_usd!==value.microUsd||
  typeof row.policy_hash!=='string'||row.policy_hash!==row.source_policy_hash)return {status:'pending',reason:'stake-evidence'};
 return {...value,receipt:row.receipt,asOfMs:row.as_of_ms,readId:row.id};
}

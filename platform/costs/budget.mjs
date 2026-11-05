const MICRO=1_000_000n;
const USD_LIMITS={ordinaryUsd:10n,exceptionUsd:30n,monthlyUsd:5n};

/** All amounts are integer micro-USD; the 50% reserve is advisory. */
export function assessPilotBudget(total,cash) {
  if (typeof total!=='bigint'||total<0n||typeof cash!=='bigint'||cash<0n) throw new RangeError('Non-negative cash and cost required.');
  const target=USD_LIMITS.ordinaryUsd*MICRO;
  const cashShare=cash/5n;
  const ordinaryTarget=target<cashShare?target:cashShare;
  const needsException=total>=target||total>cashShare;
  const status=total>USD_LIMITS.exceptionUsd*MICRO||total>cash?'blocked':needsException?'review':'pass';
  return {status,founderExceptionNeeded:needsException,ordinaryTargetUsdMicros:String(ordinaryTarget),
    remainingCashUsdMicros:String(cash-total),reserveGuidelineMet:(cash-total)*2n>=cash};
}

export function assessRecurring(total) {
  if (typeof total!=='bigint'||total<0n) throw new RangeError('Non-negative monthly cost required.');
  const limit=USD_LIMITS.monthlyUsd*MICRO;
  return {limitUsdMicros:String(limit),totalUsdMicros:String(total),
    status:total>limit?'over-limit':total===limit?'at-limit':total*5n>=limit*4n?'warning':'within-limit'};
}

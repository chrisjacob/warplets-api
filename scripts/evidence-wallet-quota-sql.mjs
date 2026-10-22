// Exact original wallet subset and shared RPC reservations. No resets/refunds.
export const walletQuotaSql="INSERT INTO tenx_wallet_usage(day,used) VALUES(?1,1) ON CONFLICT(day) DO UPDATE SET used=used+1 WHERE used<?2 RETURNING used";
export const rpcQuotaSql=`INSERT INTO tenx_usage(provider,day,used) VALUES(?1,?2,1)
      ON CONFLICT(provider,day) DO UPDATE SET used=used+1 WHERE used < ?3 RETURNING used`;

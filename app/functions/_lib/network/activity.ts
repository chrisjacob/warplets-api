import { nextMonth, utcMonth } from '../../../shared/network/activity';
import { neynarRead, type WalletEnv } from './wallets';
import { syncGet, syncSet } from './store';

const EPOCH = Date.UTC(2021,0,1);
const routes = [
  ['castsByFid',200,['MESSAGE_TYPE_CAST_ADD']],
  ['reactionsByFid',200,['MESSAGE_TYPE_REACTION_ADD']],
  ['linksByFid',200,['MESSAGE_TYPE_LINK_ADD','MESSAGE_TYPE_LINK_COMPACT_STATE']],
  ['userDataByFid',100,['MESSAGE_TYPE_USER_DATA_ADD']],
  ['verificationsByFid',50,['MESSAGE_TYPE_VERIFICATION_ADD_ETH_ADDRESS']],
] as const;
interface ActivityMessage { hash: string; data: {fid:number;timestamp:number;type:string;network:string} }
export function activityEvidence(input: unknown, fid: number, acceptedAt: number, month: string, types: readonly string[], now=Date.now()) {
  const m=input as ActivityMessage;
  if (!m || !/^0x[a-f0-9]{40}$/i.test(m.hash) || m.data?.fid!==fid || m.data.network!=='FARCASTER_NETWORK_MAINNET'
    || !types.includes(m.data.type) || !Number.isSafeInteger(m.data.timestamp) || m.data.timestamp<0) throw Error('Invalid Farcaster activity evidence');
  const at=EPOCH+m.data.timestamp*1000;
  if(at<acceptedAt || at>now || utcMonth(at)!==month)return null;
  return {at,hash:m.hash.toLowerCase(),type:m.data.type};
}

// One missing member-month per invocation, positive-only, with a shared credit
// cap. Pledge months need no provider reads. Latest state may omit removals or
// pruned messages, so a negative result never establishes churn.
async function readNextActivity(env:WalletEnv) {
  if(!env.NEYNAR_API_KEY)return {status:'unavailable'};
  if(await syncGet(env.WARPLETS,'activity_cooldown',0)>Date.now())return {status:'cooldown'};
  const now=Date.now(),current=utcMonth(now);
  const rows=await env.WARPLETS.prepare(`SELECT fid,MIN(event_at) acceptedAt FROM network_events GROUP BY fid`).all<{fid:number;acceptedAt:number}>();
  const recorded=new Set((await env.WARPLETS.prepare('SELECT fid,month FROM network_activity_months').all<{fid:number;month:string}>()).results.map(r=>`${r.fid}:${r.month}`));
  const checks=new Map((await env.WARPLETS.prepare('SELECT fid,month,checked_at FROM network_activity_checks').all<{fid:number;month:string;checked_at:number}>()).results.map(r=>[`${r.fid}:${r.month}`,r.checked_at]));
  let candidate:{fid:number;acceptedAt:number;month:string;checked:number}|null=null;
  for(const row of rows.results)for(let month=nextMonth(utcMonth(row.acceptedAt)),i=0;month<=current&&i<120;month=nextMonth(month),i++) {
    const key=`${row.fid}:${month}`,checked=checks.get(key)??0;
    if(recorded.has(key)||checked>now-86_400_000)continue;
    if(!candidate||checked<candidate.checked)candidate={...row,month,checked};
  }
  if(!candidate)return {status:'complete'};
  const {fid,acceptedAt,month}=candidate;
  try {
    for(const [route,credits,types] of routes) {
      const data=await neynarRead(env,`/v1/${route}?fid=${fid}&pageSize=1&reverse=true`,credits,'snapchain') as {messages:unknown[];nextPageToken:string};
      if(!Array.isArray(data.messages)||data.messages.length>1||typeof data.nextPageToken!=='string')throw Error('Invalid activity page');
      for(const message of data.messages) {
        const evidence=activityEvidence(message,fid,acceptedAt,month,types,now);
        if(!evidence)continue;
        await env.WARPLETS.prepare(`INSERT OR IGNORE INTO network_activity_months(fid,month,action_at,message_hash,action_type,source,observed_at) VALUES(?,?,?,?,?,'neynar-snapchain',?)`).bind(fid,month,evidence.at,evidence.hash,evidence.type,now).run();
        return {status:'observed',fid,month};
      }
    }
    await env.WARPLETS.prepare(`INSERT INTO network_activity_checks(fid,month,checked_at) VALUES(?,?,?) ON CONFLICT(fid,month) DO UPDATE SET checked_at=excluded.checked_at`).bind(fid,month,now).run();
    return {status:'unresolved',fid,month};
  } catch(error) {
    await syncSet(env.WARPLETS,'activity_cooldown',now+900_000);
    throw error;
  }
}

export async function importNetworkActivity(env:WalletEnv) {
  const owner=crypto.randomUUID(),now=Date.now();
  const lease=await env.WARPLETS.prepare(`INSERT INTO network_leases(name,owner,expires_at) VALUES('activity',?,?) ON CONFLICT(name) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE network_leases.expires_at<? RETURNING owner`).bind(owner,now+600_000,now).first<{owner:string}>();
  if(lease?.owner!==owner)return {status:'busy'};
  try{return await readNextActivity(env);}finally{await env.WARPLETS.prepare("DELETE FROM network_leases WHERE name='activity' AND owner=?").bind(owner).run();}
}

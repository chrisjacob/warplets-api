import { NETWORK_CURRENT_COHORT } from './cohort';
import { nextMonth, utcMonth } from '../../../shared/network/activity';
import { neynarRead, type WalletEnv } from './wallets';
import { bounded, syncGet, syncSet } from './store';

const EPOCH = Date.UTC(2021,0,1);
const routes = [
  ['userDataByFid',1,['MESSAGE_TYPE_USER_DATA_ADD']],
  ['verificationsByFid',5,['MESSAGE_TYPE_VERIFICATION_ADD_ETH_ADDRESS','MESSAGE_TYPE_VERIFICATION_REMOVE']],
  ['linksByFid?link_type=follow',200,['MESSAGE_TYPE_LINK_ADD','MESSAGE_TYPE_LINK_REMOVE','MESSAGE_TYPE_LINK_COMPACT_STATE']],
] as const;
interface ActivityMessage { hash: string; data: {fid:number;timestamp:number;type:string;network:string} }
export function activityEvidence(input: unknown, fid: number, acceptedAt: number, month: string, types: readonly string[], now=Date.now()) {
  const m=input as ActivityMessage;
  const invalid=!m?'message':!/^0x[a-f0-9]{40}$/i.test(m.hash)?'hash':m.data?.fid!==fid?'fid':m.data.network!=='FARCASTER_NETWORK_MAINNET'?'network':!types.includes(m.data.type)?`type ${m.data.type}`:!Number.isSafeInteger(m.data.timestamp)||m.data.timestamp<0?'timestamp':null;
  if(invalid)throw Error(`Invalid Farcaster activity evidence (${invalid})`);
  const at=EPOCH+m.data.timestamp*1000;
  if(at<acceptedAt || at>now || utcMonth(at)!==month)return null;
  return {at,hash:m.hash.toLowerCase(),type:m.data.type};
}

// Cheap indexed hints are always confirmed against the original protocol
// message. A target cast's hash is never saved as a reaction message hash.
export async function indexedActivityEvidence(env:WalletEnv,fid:number,acceptedAt:number,month:string,now=Date.now()){
 for(const kind of ['reactions','casts'] as const){
  const path=kind==='reactions'?`/v2/farcaster/reactions/user/?fid=${fid}&type=all&limit=1`:`/v2/farcaster/feed/user/casts/?fid=${fid}&include_replies=true&limit=1`;
  const payload=await neynarRead(env,path,kind==='reactions'?2:4) as {reactions?:{user:{fid:number};reaction_type:string;reaction_timestamp:string;cast:{hash:string;author:{fid:number}}}[];casts?:{hash:string;author:{fid:number};timestamp:string}[]};
  const rows=kind==='reactions'?payload.reactions:payload.casts;
  if(!Array.isArray(rows)||rows.length>1)throw Error('Invalid indexed activity hint');
  const hint=rows[0];if(!hint)continue;
  const reaction='reaction_type' in hint;
  const at=Date.parse(reaction?hint.reaction_timestamp:hint.timestamp);
  if((reaction?hint.user.fid:hint.author.fid)!==fid||!Number.isFinite(at))throw Error('Mismatched indexed activity hint');
  if(at<acceptedAt||at>now||utcMonth(at)!==month)continue;
  const hash=reaction?hint.cast.hash:hint.hash;
  if(!/^0x[a-f0-9]{40}$/i.test(hash))throw Error('Invalid indexed activity hash');
  if(reaction&&!['like','recast'].includes(hint.reaction_type))throw Error('Invalid indexed reaction type');
  const lookup=reaction?`reactionById?fid=${fid}&reaction_type=${hint.reaction_type==='like'?'Like':'Recast'}&target_fid=${hint.cast.author.fid}&target_hash=${hash}`:`castById?fid=${fid}&hash=${hash}`;
  const message=await neynarRead(env,`/v1/${lookup}`,1,'snapchain');
  const evidence=activityEvidence(message,fid,acceptedAt,month,[reaction?'MESSAGE_TYPE_REACTION_ADD':'MESSAGE_TYPE_CAST_ADD'],now);
  if(evidence&&evidence.at===at)return evidence;
 }
 return null;
}

// A bounded batch of missing member-months, positive-only, with a shared credit
// cap. Pledge months need no provider reads. Latest state may omit removals or
// pruned messages, so a negative result never establishes churn.
async function readNextActivity(env:WalletEnv,limit:number) {
  if(!env.NEYNAR_API_KEY)return {status:'unavailable'};
  if(await syncGet(env.WARPLETS,'activity_cooldown',0)>Date.now())return {status:'cooldown'};
  const now=Date.now(),current=utcMonth(now);
  const rows=await env.WARPLETS.prepare(`SELECT fid,MIN(event_at) acceptedAt FROM network_events WHERE fid IN (${NETWORK_CURRENT_COHORT}) GROUP BY fid`).all<{fid:number;acceptedAt:number}>();
  const recorded=new Set((await env.WARPLETS.prepare('SELECT fid,month FROM network_activity_months').all<{fid:number;month:string}>()).results.map(r=>`${r.fid}:${r.month}`));
  const checks=new Map((await env.WARPLETS.prepare('SELECT fid,month,checked_at FROM network_activity_checks').all<{fid:number;month:string;checked_at:number}>()).results.map(r=>[`${r.fid}:${r.month}`,r.checked_at]));
  const candidates:{fid:number;acceptedAt:number;month:string;checked:number}[]=[];
  for(const row of rows.results)for(let month=nextMonth(utcMonth(row.acceptedAt)),i=0;month<=current&&i<120;month=nextMonth(month),i++) {
    const key=`${row.fid}:${month}`,checked=checks.get(key)??0;
    if(recorded.has(key)||checked>now-86_400_000)continue;
    candidates.push({...row,month,checked});
  }
  candidates.sort((a,b)=>a.checked-b.checked||a.fid-b.fid||a.month.localeCompare(b.month));
  const batch=candidates.slice(0,limit);
  if(!batch.length)return {status:'complete'};
  let index=0,observed=0,unresolved=0,paused=false;
  const outcomes=await Promise.allSettled(Array.from({length:Math.min(4,batch.length)},async()=>{
   while(index<batch.length&&!paused){
    const {fid,acceptedAt,month}=batch[index++];
    let found=false;
    try {
    for(const [route,credits,types] of routes) {
      if(route==='verificationsByFid'){
       const indexed=await indexedActivityEvidence(env,fid,acceptedAt,month,now);
       if(indexed){await env.WARPLETS.prepare(`INSERT OR IGNORE INTO network_activity_months(fid,month,action_at,message_hash,action_type,source,observed_at) VALUES(?,?,?,?,?,'neynar-snapchain',?)`).bind(fid,month,indexed.at,indexed.hash,indexed.type,now).run();found=true;break;}
      }
      let pageToken='';const pages=new Set<string>();
      for(let page=0;page<10;page++){
      let data:{messages:unknown[];nextPageToken:string};
      try{data=await neynarRead(env,`/v1/${route}${route.includes('?')?'&':'?'}fid=${fid}&pageSize=100&reverse=true${pageToken?`&pageToken=${encodeURIComponent(pageToken)}`:''}`,credits,'snapchain') as typeof data;}
      catch(error){throw Error(`Activity ${route}: ${error instanceof Error?error.message:'source unavailable'}`);}
      if(!Array.isArray(data.messages)||data.messages.length>100||typeof data.nextPageToken!=='string')throw Error('Invalid activity page');
      for(const message of data.messages) {
        let evidence:ReturnType<typeof activityEvidence>;
        try{evidence=activityEvidence(message,fid,acceptedAt,month,types,now);}catch(error){throw Error(`Activity ${route}: ${error instanceof Error?error.message:'invalid evidence'}`);}
        if(!evidence)continue;
        await env.WARPLETS.prepare(`INSERT OR IGNORE INTO network_activity_months(fid,month,action_at,message_hash,action_type,source,observed_at) VALUES(?,?,?,?,?,'neynar-snapchain',?)`).bind(fid,month,evidence.at,evidence.hash,evidence.type,now).run();
        found=true;break;
      }
      const earliest=Math.min(...data.messages.map(message=>EPOCH+(message as ActivityMessage).data.timestamp*1000));
      if(found||!data.nextPageToken||earliest<Date.parse(month+'-01T00:00:00Z'))break;
      if(data.nextPageToken.length>2000||pages.has(data.nextPageToken))throw Error('Invalid activity cursor');
      pageToken=data.nextPageToken;pages.add(pageToken);
      }
      if(found)break;
    }
    await env.WARPLETS.prepare(`INSERT INTO network_activity_checks(fid,month,checked_at) VALUES(?,?,?) ON CONFLICT(fid,month) DO UPDATE SET checked_at=excluded.checked_at`).bind(fid,month,now).run();
    if(found)observed++;else unresolved++;
    } catch(error) {
    paused=true;
    await syncSet(env.WARPLETS,'activity_cooldown',now+900_000);
    throw error;
    }
   }
  }));
  const failed=outcomes.find(r=>r.status==='rejected');
  if(failed?.status==='rejected')throw failed.reason;
  if(batch.length===1)return {status:observed?'observed':'unresolved',fid:batch[0].fid,month:batch[0].month};
  return {status:'advanced',observed,unresolved};
}

export async function importNetworkActivity(env:WalletEnv,limit=bounded(env.NETWORK_ACTIVITY_BATCH,20,100)) {
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('Invalid activity batch');
  const owner=crypto.randomUUID(),now=Date.now();
  const lease=await env.WARPLETS.prepare(`INSERT INTO network_leases(name,owner,expires_at) VALUES('activity',?,?) ON CONFLICT(name) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE network_leases.expires_at<? RETURNING owner`).bind(owner,now+600_000,now).first<{owner:string}>();
  if(lease?.owner!==owner)return {status:'busy'};
  try{return await readNextActivity(env,limit);}finally{await env.WARPLETS.prepare("DELETE FROM network_leases WHERE name='activity' AND owner=?").bind(owner).run();}
}

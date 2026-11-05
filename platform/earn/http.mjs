import { consumeQuota, currentSession } from '../server/auth.mjs';
import { failure, json } from '../server/api.mjs';
import { DAY_MS } from '../domain/earn/index.mjs';
import { listActiveActions } from './components.mjs';
import { exportBoard, proofForWallet, recoveryMode } from './archive.mjs';
import { capacityAt } from './operations.mjs';
import { actionDecision } from '../operations/controls.mjs';
import { EarnError, readLeaderboard, readWalletClaims, readWalletSubmissions, submitContent } from './workflow.mjs';

const base='/api/v1/earn';
function dateEpoch(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new EarnError(400,'invalid_epoch','Use a UTC YYYY-MM-DD date.');
  const ms=Date.parse(value+'T00:00:00.000Z');
  if (!Number.isFinite(ms) || ms<0 || new Date(ms).toISOString().slice(0,10)!==value) {
    throw new EarnError(400,'invalid_epoch','Invalid UTC date.');
  }
  return ms/DAY_MS;
}
async function boundedJson(request) {
  const limit=4096;
  const length=request.headers.get('content-length');
  if (length && Number(length)>limit) throw new EarnError(413,'body_too_large','Content submission exceeds 4 KiB.');
  const reader=request.body?.getReader();
  if (!reader) throw new EarnError(400,'invalid_input','Expected a submission object.');
  let total=0;
  const chunks=[];
  try {
    for (;;) {
      const {done,value}=await reader.read();
      if (done) break;
      total+=value.byteLength;
      if (total>limit) {
        await reader.cancel();
        throw new EarnError(413,'body_too_large','Content submission exceeds 4 KiB.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw new EarnError(400,'invalid_input','Invalid submission JSON.'); }
}

export async function handleEarn(db,request,peer,now) {
  const url=new URL(request.url);
  const board=url.pathname.match(/^\/api\/v1\/earn\/epochs\/([^/]+)\/(leaderboard|manifest)$/);
  const post=url.pathname===base+'/submissions';
  const me=url.pathname===base+'/me';
  const claims=url.pathname===base+'/claims';
  const proof=url.pathname===base+'/claims/proof';
  const actions=url.pathname===base+'/actions';
  const capacity=url.pathname===base+'/capacity';
  if (!board && !post && !me && !claims && !actions && !proof && !capacity) return null;
  const expected=post?'POST':'GET';
  if (request.method!==expected) return failure(405,'method_not_allowed','Unsupported method.',{allow:expected});
  try {
    if (board || actions || capacity) {
      const quota=consumeQuota(db,'earn-read:'+peer,now,60);
      if (quota) return quota;
      if (board) {
        const epoch=dateEpoch(board[1]);
        return json(board[2]==='manifest'?exportBoard(db,epoch):readLeaderboard(db,epoch));
      }
      const epoch=Math.floor(now/DAY_MS);
      if (capacity) {
        const available=capacityAt(db,epoch,now);
        return json({mode:'local-fixture',...available,accepting:!recoveryMode(db)&&available.accepting&&actionDecision(db,'earn-admission',now).allowed});
      }
      return json({epoch,mode:'local-fixture',items:listActiveActions(db,epoch)});
    }
    if (post && request.headers.get('origin')!==url.origin) return failure(403,'invalid_origin','Use the configured local origin.');
    const session=currentSession(db,request,now);
    if (!session) return failure(401,'authentication_required','Connect your wallet.');
    const quota=consumeQuota(db,(post?'earn-submit:':'earn-wallet-read:')+session.wallet,now,post?10:60);
    if (quota) return quota;
    if (proof) {
      const day=url.searchParams.get('day'),tokenId=url.searchParams.get('tokenId');
      if (!/^(?:[1-9]|10)$/.test(day??'') || !tokenId || tokenId.length>256) return failure(400,'invalid_input','Supply a tokenId and campaign day 1–10.');
      return json(proofForWallet(db,{wallet:session.wallet,tokenId,day:Number(day)}));
    }
    if (post) {
      if (recoveryMode(db)) return failure(409,'read_only_archive','Public archive serves existing awards.');
      if (request.headers.get('content-type')?.split(';')[0]!=='application/json') return failure(415,'unsupported_media_type','Use application/json.');
      const body=await boundedJson(request);
      if (!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>!['tokenId','url'].includes(k))) {
        return failure(400,'invalid_input','Supply only tokenId and url.');
      }
      const result=submitContent(db,{wallet:session.wallet,tokenId:body.tokenId,url:body.url,
        requestKey:request.headers.get('idempotency-key'),nowMs:now});
      return json({mode:'local-fixture',...result.submission},result.replay?200:201);
    }
    const cursor=url.searchParams.get('cursor')??'0';
    if (!/^\d{1,15}$/.test(cursor)) return failure(400,'invalid_cursor','Invalid cursor.');
    const args={wallet:session.wallet,nowMs:now,after:Number(cursor)};
    return json(claims?readWalletClaims(db,args):readWalletSubmissions(db,args));
  } catch(error) {
    if (error instanceof EarnError) return failure(error.status,error.code,error.message);
    throw error;
  }
}

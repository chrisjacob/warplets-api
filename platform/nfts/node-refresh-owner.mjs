import {randomUUID,createHash} from 'node:crypto';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createAtomicReceipts} from '../storage/atomic-receipts.mjs';
import {currentSession,consumeQuota} from '../server/auth.mjs';
import {createRefreshRepository} from './refresh-repository.mjs';
import {createRefreshOwnerService,RefreshOwnerError} from './refresh-owner-service.mjs';
import {handleRefreshOwner} from './refresh-owner-http.mjs';
export function createNodeRefreshOwner(db,{clock=Date.now,artifacts,driver}={}){const crypto=createNodeCrypto(),ids={next:randomUUID},ports={crypto,ids,clock:{nowMs:clock},artifacts:artifacts??{async getVerified(identity){return {status:'missing',identity};}}},live=a=>!!db.prepare('SELECT 1 FROM sessions WHERE token_hash=? AND wallet=? AND origin=? AND expires_at>?').get(a.sessionHash,a.principal.wallet,a.origin,clock()),guard=a=>()=>{if(!live(a))throw new RefreshOwnerError(401,'authentication_required','Session expired or was revoked.');},base=a=>driver??createNodeAtomicDriver(db,{transactionGuard:guard(a)}),service=createRefreshOwnerService({...ports,authorize:async a=>live(a),repositoryFor:a=>{const d=base(a);return createRefreshRepository(d,{...ports,authoritySnapshot:()=>({sql:`EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND wallet=? AND origin=? AND expires_at>${d.leaseNowSql??"CAST(unixepoch('subsec')*1000 AS INTEGER)"})`,values:[a.sessionHash,a.principal.wallet,a.origin]})});},replayFor:(a,c)=>createAtomicReceipts(base(a),ports).replay(c)});
 return request=>handleRefreshOwner(request,{service,authenticate:async req=>{const session=currentSession(db,req,clock());if(!session)return null;const token=(req.headers.get('cookie')??'').split(';').map(s=>s.trim()).find(s=>s.startsWith('tenx_local_session='))?.slice(19);if(!token)return null;return Object.freeze({principal:Object.freeze({kind:'wallet',wallet:session.wallet}),sessionHash:createHash('sha256').update(token).digest('hex'),origin:new URL(req.url).origin});},consumeQuota:async(bucket,limit)=>consumeQuota(db,bucket,clock(),limit)});
}

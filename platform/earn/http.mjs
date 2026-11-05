import {consumeQuota,currentSession} from '../server/auth.mjs';
import {failure,json} from '../server/api.mjs';
import {exportBoard,proofForWallet} from './archive.mjs';
import {EarnError} from './validation.mjs';
import {createNodeGuardedEarnService} from '../application/node-context.mjs';
import {handleInteractiveEarn} from './interactive-http.mjs';
// Node retains its explicitly labeled archive/proof routes. Interactive Earn
// goes through exactly the same portable application and HTTP handler as D1.
export async function handleEarn(db,request,peer,now,service=createNodeGuardedEarnService(db,{nowMs:now})){
 const response=await handleInteractiveEarn(request,{service,peer,
  authenticate:async req=>{const session=currentSession(db,req,now);return session?{kind:'wallet',wallet:session.wallet}:null;},
  consumeQuota:async(bucket,limit)=>consumeQuota(db,bucket,now,limit)});
 if(response)return response;
 const url=new URL(request.url),board=url.pathname.match(/^\/api\/v1\/earn\/epochs\/([^/]+)\/manifest$/),proof=url.pathname==='/api/v1/earn/claims/proof';
 if(!board&&!proof)return null;
 if(request.method!=='GET')return failure(405,'method_not_allowed','Unsupported method.',{allow:'GET'});
 try{
  if(board){
   const quota=consumeQuota(db,'earn-read:'+peer,now,60);if(quota)return quota;
   const date=board[1],ms=Date.parse(date+'T00:00:00.000Z');
   if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(ms)||ms<0||new Date(ms).toISOString().slice(0,10)!==date)throw new EarnError(400,'invalid_epoch','Use a UTC YYYY-MM-DD date.');
   return json(exportBoard(db,ms/86400000));
  }
  const session=currentSession(db,request,now);if(!session)return failure(401,'authentication_required','Connect your wallet.');
  const quota=consumeQuota(db,'earn-wallet-read:'+session.wallet,now,60);if(quota)return quota;
  const day=url.searchParams.get('day'),tokenId=url.searchParams.get('tokenId');
  if(!/^(?:[1-9]|10)$/.test(day??'')||!tokenId||tokenId.length>256)return failure(400,'invalid_input','Supply a tokenId and campaign day1-10.');
  return json(proofForWallet(db,{wallet:session.wallet,tokenId,day:Number(day)}));
 }catch(error){if(error instanceof EarnError)return failure(error.status,error.code,error.message);throw error;}
}

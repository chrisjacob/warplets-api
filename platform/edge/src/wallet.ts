import {Hono} from 'hono';
import {getCookie,setCookie} from 'hono/cookie';
import {z} from 'zod';
import {signerKey,signatureBytes} from '../../security/ed25519.mjs';
export const sessionCookie='tenx_edge_local_session';
const cookie=sessionCookie;
export const edgeAuth=new Hono<{Bindings:Env}>();
const hash=async(value:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))]
  .map(x=>x.toString(16).padStart(2,'0')).join('');
function token():string {
 const bytes=crypto.getRandomValues(new Uint8Array(32));
 return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
export async function boundedInput(req:Request) {
 if(req.headers.get('content-type')?.split(';')[0]!=='application/json')return null;
 const reader=req.body?.getReader();if(!reader)return null;
 let bytes=0;const decoder=new TextDecoder('utf-8',{fatal:true});let text='';
 try{
  for(;;){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;
    if(bytes>4096){await reader.cancel();return null;}text+=decoder.decode(chunk.value,{stream:true});}
  return JSON.parse(text+decoder.decode());
 }catch{return null;}finally{reader.releaseLock();}
}
edgeAuth.use('/auth/*',async(c,next)=>{
 if(c.req.method!=='POST')return c.json({error:{code:'method_not_allowed',message:'Use POST.'}},405);
 if(c.req.header('origin')!==new URL(c.req.url).origin)return c.json({error:{code:'invalid_origin',message:'Use this local origin.'}},403);
 const now=Date.now();
 // A single loopback bucket bounds pilot challenge and verification writes across isolates.
 const rate=await c.env.DB.prepare(`INSERT INTO request_limits VALUES('edge-local-auth',?,1)
 ON CONFLICT(bucket) DO UPDATE SET hits=CASE WHEN resets_at<=? THEN 1 ELSE hits+1 END,
 resets_at=CASE WHEN resets_at<=? THEN excluded.resets_at ELSE resets_at END RETURNING hits,resets_at`)
 .bind(now+60000,now,now).first<{hits:number;resets_at:number}>();
 if(!rate||rate.hits>15){c.header('retry-after',String(Math.max(1,Math.ceil(((rate?.resets_at??now+60000)-now)/1000))));
  return c.json({error:{code:'rate_limited',message:'Please retry later.'}},429);}
 await next();
});
edgeAuth.post('/auth/challenges',async c=>{
 const body=z.object({wallet:z.string().min(32).max(44)}).strict().safeParse(await boundedInput(c.req.raw));
 if(!body.success)return c.json({error:{code:'invalid_input',message:'A wallet is required.'}},400);
 try{signerKey(body.data.wallet);}catch{return c.json({error:{code:'invalid_input',message:'Invalid wallet address.'}},400);}
 const now=Date.now(),nonce=token(),origin=new URL(c.req.url).origin,expiresAt=new Date(now+300000).toISOString();
 const message=[origin+' requests a 10X.MEME wallet signature.','Action: Sign in to the local preview','Chain: solana',
  'Wallet: '+body.data.wallet,'Nonce: '+nonce,'Issued: '+new Date(now).toISOString(),'Expires: '+expiresAt].join('\n');
 await c.env.DB.batch([c.env.DB.prepare('DELETE FROM auth_challenges WHERE nonce IN (SELECT nonce FROM auth_challenges WHERE expires_at<=? ORDER BY expires_at LIMIT 100)').bind(now),
  c.env.DB.prepare('DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires_at<=? ORDER BY expires_at LIMIT 100)').bind(now),
  c.env.DB.prepare('INSERT INTO auth_challenges VALUES(?,?,?,?,?,NULL)').bind(nonce,body.data.wallet,origin,message,now+300000)]);
 return c.json({nonce,message,expiresAt},201);
});
edgeAuth.post('/auth/verify',async c=>{
 const parsed=z.object({nonce:z.string().length(43),signature:z.string().max(88)}).strict().safeParse(await boundedInput(c.req.raw));
 if(!parsed.success)return c.json({error:{code:'invalid_input',message:'A nonce and signature are required.'}},400);
 const origin=new URL(c.req.url).origin,now=Date.now(),{nonce,signature}=parsed.data;
 const challenge=await c.env.DB.prepare('SELECT wallet,message FROM auth_challenges WHERE nonce=? AND origin=? AND expires_at>? AND consumed_at IS NULL')
   .bind(nonce,origin,now).first<{wallet:string;message:string}>();
 if(!challenge)return c.json({error:{code:'invalid_challenge',message:'Challenge unavailable.'}},401);
 let valid=false;
 try{
  const raw=new Uint8Array(signerKey(challenge.wallet));
  const key=await crypto.subtle.importKey('raw',raw,'Ed25519',false,['verify']);
  valid=await crypto.subtle.verify('Ed25519',key,new Uint8Array(signatureBytes(signature)),new TextEncoder().encode(challenge.message));
 }catch{valid=false;}
 if(!valid)return c.json({error:{code:'invalid_signature',message:'Wallet proof failed.'}},401);
 const session=token(),digest=await hash(session),issued=Date.now();
 const [claim,sessionInsert]=await c.env.DB.batch([
  c.env.DB.prepare('INSERT OR IGNORE INTO edge_proof_consumptions SELECT nonce,? FROM auth_challenges WHERE nonce=? AND origin=? AND consumed_at IS NULL AND expires_at>?').bind(digest,nonce,origin,issued),
  c.env.DB.prepare('INSERT INTO sessions SELECT ?,c.wallet,c.origin,? FROM auth_challenges c JOIN edge_proof_consumptions p ON p.nonce=c.nonce AND p.session_hash=? WHERE c.nonce=?').bind(digest,issued+86400000,digest,nonce),
  c.env.DB.prepare('UPDATE auth_challenges SET consumed_at=? WHERE nonce=? AND EXISTS(SELECT 1 FROM edge_proof_consumptions WHERE nonce=? AND session_hash=?)').bind(issued,nonce,nonce,digest)]);
 if(claim.meta.changes!==1||sessionInsert.meta.changes!==1)return c.json({error:{code:'invalid_challenge',message:'Challenge unavailable.'}},401);
 setCookie(c,cookie,session,{httpOnly:true,sameSite:'Strict',path:'/',maxAge:86400});
 return c.json({wallet:challenge.wallet});
});
export async function sessionOwner(req:Request,db:D1Database,raw:string|undefined){
 if(!raw)return null;
 return db.prepare('SELECT wallet FROM sessions WHERE token_hash=? AND origin=? AND expires_at>?').bind(await hash(raw),new URL(req.url).origin,Date.now()).first<string>('wallet');
}
edgeAuth.get('/me',async c=>{
 const wallet=await sessionOwner(c.req.raw,c.env.DB,getCookie(c,cookie));
 return wallet?c.json({wallet,chain:'solana'}):c.json({error:{code:'authentication_required',message:'Connect your wallet.'}},401);
});
edgeAuth.get('/me/wallets',async c=>{
 const wallet=await sessionOwner(c.req.raw,c.env.DB,getCookie(c,cookie));
 return wallet?c.json({items:[{address:wallet,chain:'solana'}]}):c.json({error:{code:'authentication_required',message:'Connect your wallet.'}},401);
});
edgeAuth.post('/auth/logout',async c=>{
 const raw=getCookie(c,cookie);
 if(raw)await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash=? AND origin=?').bind(await hash(raw),new URL(c.req.url).origin).run();
 setCookie(c,cookie,'',{httpOnly:true,sameSite:'Strict',path:'/',maxAge:0});
 return c.json({revoked:true});
});

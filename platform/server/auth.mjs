import { randomBytes, createHash, createPublicKey, verify } from 'node:crypto';
import { signerKey,signatureBytes } from '../security/ed25519.mjs';
import { transaction } from '../storage/database.mjs';
import { json, failure } from './api.mjs';

const prefix='/api/v1';
const hash=value=>createHash('sha256').update(value).digest('hex');
const token=()=>randomBytes(32).toString('base64url');
const cookieName='tenx_local_session';
const ttl=24*3600;
const invalid=(message)=>failure(400,'invalid_input',message);
const header=Buffer.from('302a300506032b6570032100','hex');

export function currentSession(db,request,now) {
  const cookie=(request.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='));
  if(!cookie) return null;
  return db.prepare('SELECT wallet,expires_at FROM sessions WHERE token_hash=? AND origin=? AND expires_at>?')
    .get(hash(cookie.slice(cookieName.length+1)),new URL(request.url).origin,now)??null;
}
function setCookie(raw,maxAge) {
  return cookieName+'='+raw+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+maxAge;
}
export function consumeQuota(db,key,now,max) {
  const reset=now+60000;
  const result=db.prepare(`INSERT INTO request_limits VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET
    hits=CASE WHEN resets_at<=? THEN 1 ELSE hits+1 END,
    resets_at=CASE WHEN resets_at<=? THEN excluded.resets_at ELSE resets_at END RETURNING hits,resets_at`)
    .get(key,reset,now,now);
  if(result.hits<=max) return null;
  return failure(429,'rate_limited','Please retry later.',{'retry-after':String(Math.ceil((result.resets_at-now)/1000))});
}
export async function handleAuth(db,request,peer,now) {
  const {pathname,origin}=new URL(request.url);
  const me=pathname===prefix+'/me'||pathname===prefix+'/me/wallets';
  const endpoint=pathname.slice(prefix.length);
  if(!me&&!['/auth/challenges','/auth/verify','/auth/logout'].includes(endpoint)) return null;
  const expected=me?'GET':'POST';
  if(request.method!==expected) return failure(405,'method_not_allowed','Unsupported method.',{allow:expected});
  if(me) {
    const session=currentSession(db,request,now);
    if(!session) return failure(401,'authentication_required','Connect your wallet.');
    return json(endpoint==='/me'?{wallet:session.wallet,chain:'solana'}:{items:[{address:session.wallet,chain:'solana'}]});
  }
  if(request.headers.get('origin')!==origin) return failure(403,'invalid_origin','Use the configured local origin.');
  const quota=consumeQuota(db,'auth:'+peer,now,15);
  if(quota) return quota;
  if(endpoint==='/auth/logout') {
    const raw=(request.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='));
    if(raw) db.prepare('DELETE FROM sessions WHERE token_hash=? AND origin=?').run(hash(raw.slice(cookieName.length+1)),origin);
    return json({revoked:true},200,{'set-cookie':setCookie('',0)});
  }
  if(request.headers.get('content-type')?.split(';')[0]!=='application/json') return failure(415,'unsupported_media_type','Use application/json.');
  let body;
  try {body=await request.json();}catch {return invalid('Invalid JSON.');}
  if(!body||typeof body!=='object'||Array.isArray(body)) return invalid('Expected an object.');
  if(endpoint==='/auth/challenges') {
    try {signerKey(body.wallet);} catch {return invalid('Expected a Solana wallet address.');}
    const nonce=token(),expiresAt=now+300000;
    const message=[origin+' requests a 10X.MEME wallet signature.','Action: Sign in to the local preview',
      'Chain: solana','Wallet: '+body.wallet,'Nonce: '+nonce,'Issued: '+new Date(now).toISOString(),
      'Expires: '+new Date(expiresAt).toISOString()].join('\n');
    db.prepare('INSERT INTO auth_challenges VALUES(?,?,?,?,?,NULL)').run(nonce,body.wallet,origin,message,expiresAt);
    return json({nonce,message,expiresAt:new Date(expiresAt).toISOString()},201);
  }
  if(typeof body.nonce!=='string'||body.nonce.length!==43) return invalid('Invalid nonce.');
  const row=db.prepare('SELECT * FROM auth_challenges WHERE nonce=? AND consumed_at IS NULL AND origin=? AND expires_at>?').get(body.nonce,origin,now);
  if(!row) return failure(401,'invalid_challenge','Challenge expired or unavailable.');
  let sig;try{sig=signatureBytes(body.signature);}catch{return invalid('Expected a base58 Ed25519 signature.');}
  const key=createPublicKey({key:Buffer.concat([header,signerKey(row.wallet)]),format:'der',type:'spki'});
  if(!verify(null,Buffer.from(row.message),key,sig)) return failure(401,'invalid_signature','Wallet signature mismatch.');
  const sessionToken=token();
  const issued=transaction(db,()=>{
    const consumed=db.prepare('UPDATE auth_challenges SET consumed_at=? WHERE nonce=? AND consumed_at IS NULL AND expires_at>?').run(now,row.nonce,now);
    if(consumed.changes!==1) return false;
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(sessionToken),row.wallet,origin,now+ttl*1000);
    return true;
  });
  return issued?json({wallet:row.wallet},200,{'set-cookie':setCookie(sessionToken,ttl)}):failure(401,'invalid_challenge','Challenge unavailable.');
}

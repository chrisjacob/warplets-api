import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';

export const OPERATOR_SESSION_MAX_TTL_MS=2*60*60*1000;
const digest=value=>createHash('sha256').update(value).digest();
const kindPattern=/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/;
const bearerPattern=/^[A-Za-z0-9_-]{43}$/;

export class OperatorSessionError extends Error {
 constructor(status,code,message){super(message);this.name='OperatorSessionError';this.status=status;this.code=code;}
}
const denied=(code='operator_required')=>new OperatorSessionError(401,code,'A current local operator session is required.');
function validBootCode(code){return typeof code==='string'&&code.length>=32&&code.length<=256;}

/** Volatile Node-only authority. No database grants, hosted identity or wallet
 * authentication are implied. Restarting this factory invalidates its tokens.
 * The trusted process alone may issue a fresh bootstrap code after logout.
 */
export function createOperatorSessionAuthority({bootCode,operatorId,allowedKinds=[],ttlMs=OPERATOR_SESSION_MAX_TTL_MS,clock=Date.now}={}){
 if(!validBootCode(bootCode))throw new TypeError('A strong bounded operator bootstrap code is required.');
 if(typeof operatorId!=='string'||operatorId.length<1||operatorId.length>128||operatorId.trim()!==operatorId||/[\u0000-\u001f\u007f]/.test(operatorId))throw new TypeError('An explicit stable operator identity is required.');
 if(!Array.isArray(allowedKinds)||allowedKinds.length>64||allowedKinds.some(k=>typeof k!=='string'||k.length>96||!kindPattern.test(k))||new Set(allowedKinds).size!==allowedKinds.length)throw new TypeError('Explicit unique operator command kinds are required.');
 if(!Number.isSafeInteger(ttlMs)||ttlMs<1||ttlMs>OPERATOR_SESSION_MAX_TTL_MS||typeof clock!=='function')throw new TypeError('Operator session expiry must be positive and at most two hours.');
 const principal=Object.freeze({kind:'operator',id:operatorId}),kinds=Object.freeze([...allowedKinds]),allowed=new Set(kinds);
 let bootDigest=digest(bootCode),generation=0,session=null,failures=0,attemptUntil=0;
 bootCode=undefined;
 function now(){const value=clock();if(!Number.isSafeInteger(value)||value<0)throw denied('operator_clock_invalid');return value;}
 function advanceGeneration(){if(generation===Number.MAX_SAFE_INTEGER)throw denied('operator_generation_exhausted');generation++;}
 function check(tokenDigest,expectedGeneration,operationKind){
  if(!session||expectedGeneration!==generation||session.generation!==generation||!timingSafeEqual(tokenDigest,session.digest))throw denied('operator_session_revoked');
  const atMs=now();if(atMs<session.issuedAtMs||atMs>=session.expiresAtMs){session=null;advanceGeneration();throw denied('operator_session_expired');}
  if(operationKind!==undefined&&!allowed.has(operationKind))throw new OperatorSessionError(403,'operator_command_denied','This command is not allowed by the local operator session.');
 }
 function credentials(rawBearer){
  if(typeof rawBearer!=='string'||!bearerPattern.test(rawBearer)||!session)throw denied();
  const tokenDigest=digest(rawBearer),expectedGeneration=generation;check(tokenDigest,expectedGeneration);
  return {tokenDigest,expectedGeneration,expiresAtMs:session.expiresAtMs};
 }
 function authenticate(rawBearer){
  const {tokenDigest,expectedGeneration,expiresAtMs}=credentials(rawBearer);
  return Object.freeze({principal,generation:expectedGeneration,expiresAtMs,allowedKinds:kinds,
   guard(){check(tokenDigest,expectedGeneration);}});
 }
 function authorize(rawBearer,operationKind){
  const {tokenDigest,expectedGeneration,expiresAtMs}=credentials(rawBearer);
  if(typeof operationKind!=='string'||!allowed.has(operationKind))throw new OperatorSessionError(403,'operator_command_denied','This command is not allowed by the local operator session.');
  check(tokenDigest,expectedGeneration,operationKind);
  return Object.freeze({principal,operationKind,generation:expectedGeneration,expiresAtMs,allowedKinds:kinds,
   // Invoke synchronously inside the transaction, including immediately before
   // COMMIT. Passing the actual command kind also rejects accidental reuse.
   guard(actualKind=operationKind){
    if(actualKind!==operationKind)throw new OperatorSessionError(403,'operator_command_denied','The session guard belongs to a different command.');
    check(tokenDigest,expectedGeneration,operationKind);
   }});
 }
 function login(code){
  const issuedAtMs=now(),expiresAtMs=issuedAtMs+ttlMs;if(!Number.isSafeInteger(expiresAtMs)||!Number.isSafeInteger(issuedAtMs+60000))throw denied('operator_clock_invalid');
  if(issuedAtMs>=attemptUntil){attemptUntil=issuedAtMs+60000;failures=0;}
  if(failures>=5){const error=new OperatorSessionError(429,'rate_limited','Try the local operator code again later.');error.retryAfterSeconds=Math.max(1,Math.ceil((attemptUntil-issuedAtMs)/1000));throw error;}
  if(!bootDigest||!validBootCode(code)||!timingSafeEqual(digest(code),bootDigest)){failures++;throw new OperatorSessionError(401,'operator_code_unavailable','The local one-time code is unavailable.');}
  const sessionToken=randomBytes(32).toString('base64url'),tokenDigest=digest(sessionToken);
  advanceGeneration();bootDigest=null;session={digest:tokenDigest,generation,issuedAtMs,expiresAtMs};
  return Object.freeze({sessionToken,expiresAtMs,generation,principal,allowedKinds:kinds});
 }
 function revoke(){advanceGeneration();session=null;bootDigest=null;return Object.freeze({revoked:true,generation});}
 function issueBootCode(){
  const code=randomBytes(32).toString('base64url');advanceGeneration();session=null;bootDigest=digest(code);failures=0;attemptUntil=0;return code;
 }
 return Object.freeze({login,authenticate,authorize,revoke,issueBootCode});
}

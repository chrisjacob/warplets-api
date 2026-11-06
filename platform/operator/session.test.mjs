import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperatorSessionAuthority,OperatorSessionError,OPERATOR_SESSION_MAX_TTL_MS} from './session.mjs';

const bootCode='synthetic-local-operator-bootstrap-code-0001',kind='ops.configure-workload.v1',other='ops.change-scope.v1';
const error=code=>value=>value instanceof OperatorSessionError&&value.code===code;
function fixture(extra={}){let time=1000;const authority=createOperatorSessionAuthority({bootCode,operatorId:'synthetic-operator',allowedKinds:[kind,other],clock:()=>time,...extra});return {authority,setTime:value=>{time=value;}};}

test('explicit identity and one-use bootstrap produce an immutable command-scoped session',()=>{
 const config={bootCode,operatorId:'synthetic-operator',allowedKinds:[kind],clock:()=>1000};
 const authority=createOperatorSessionAuthority(config);config.operatorId='body-injected-operator';config.allowedKinds.push(other);config.clock=()=>Number.MAX_SAFE_INTEGER;
 assert.throws(()=>authority.login('wrong-but-bounded-code-with-32-characters'),error('operator_code_unavailable'));
 const login=authority.login(bootCode);assert.match(login.sessionToken,/^[A-Za-z0-9_-]{43}$/);assert.equal(login.expiresAtMs,1000+OPERATOR_SESSION_MAX_TTL_MS);
 assert.deepEqual(login.principal,{kind:'operator',id:'synthetic-operator'});assert.deepEqual(login.allowedKinds,[kind]);
 assert.throws(()=>authority.login(bootCode),error('operator_code_unavailable'));
 assert.throws(()=>{login.principal.id='forged';},TypeError);assert.throws(()=>login.allowedKinds.push(other),TypeError);
 const authorized=authority.authorize(login.sessionToken,kind);assert.equal(authorized.guard(),undefined);assert.equal(authorized.guard(kind),undefined);assert.equal(authorized.principal,login.principal);
 assert.throws(()=>authorized.guard(other),error('operator_command_denied'));assert.throws(()=>authority.authorize(login.sessionToken,other),error('operator_command_denied'));
 assert.throws(()=>{authorized.operationKind=other;},TypeError);assert.ok(Object.isFrozen(authority));
});

test('read authentication grants no command permissions by default and rejects member-shaped credentials',()=>{
 const {authority}=fixture({allowedKinds:[]}),login=authority.login(bootCode),read=authority.authenticate(login.sessionToken);
 assert.deepEqual(read.allowedKinds,[]);assert.equal(read.guard(),undefined);
 assert.throws(()=>authority.authorize(login.sessionToken,kind),error('operator_command_denied'));
 for(const value of [undefined,null,{kind:'wallet',wallet:login.sessionToken},'Bearer '+login.sessionToken,'x'.repeat(43),bootCode])assert.throws(()=>authority.authenticate(value),OperatorSessionError);
 const second=fixture().authority;assert.throws(()=>second.authenticate(login.sessionToken),OperatorSessionError);
});

test('captured guards synchronously reject exact expiry, clock rollback and revocation after an await',async()=>{
 const f=fixture({ttlMs:25}),login=f.authority.login(bootCode),command=f.authority.authorize(login.sessionToken,kind),read=f.authority.authenticate(login.sessionToken);
 f.setTime(1024);assert.equal(command.guard(),undefined);f.setTime(1025);assert.throws(()=>command.guard(),error('operator_session_expired'));assert.throws(()=>read.guard(),error('operator_session_revoked'));
 f.setTime(1001);assert.throws(()=>command.guard(),error('operator_session_revoked'),'observed expiry cannot be undone by clock rollback');
 const revoked=fixture(),token=revoked.authority.login(bootCode),captured=revoked.authority.authorize(token.sessionToken,kind);await Promise.resolve();revoked.authority.revoke();assert.throws(()=>captured.guard(),error('operator_session_revoked'));
 const rollback=fixture(),fresh=rollback.authority.login(bootCode),rollbackGuard=rollback.authority.authenticate(fresh.sessionToken).guard;rollback.setTime(999);assert.throws(rollbackGuard,error('operator_session_expired'));
 assert.throws(()=>f.authority.authenticate(login.sessionToken),OperatorSessionError);assert.throws(()=>f.authority.login(bootCode),error('operator_code_unavailable'));
});

test('five failed bootstrap attempts throttle even the correct code until the fixed minute boundary',()=>{
 const f=fixture();for(let n=0;n<5;n++)assert.throws(()=>f.authority.login('wrong'),error('operator_code_unavailable'));
 assert.throws(()=>f.authority.login(bootCode),e=>error('rate_limited')(e)&&e.status===429&&e.retryAfterSeconds===60);
 f.setTime(60999);assert.throws(()=>f.authority.login(bootCode),e=>e.retryAfterSeconds===1);
 f.setTime(61000);assert.ok(f.authority.login(bootCode).sessionToken);
});

test('trusted re-authentication rotates generation while preserving stable receipt principal',()=>{
 const f=fixture(),first=f.authority.login(bootCode),old=f.authority.authorize(first.sessionToken,kind);
 const nextCode=f.authority.issueBootCode();assert.notEqual(nextCode,bootCode);assert.throws(()=>old.guard(),error('operator_session_revoked'));
 assert.throws(()=>f.authority.login(bootCode),error('operator_code_unavailable'));
 const second=f.authority.login(nextCode);assert.ok(second.generation>first.generation);assert.notEqual(second.sessionToken,first.sessionToken);assert.equal(second.principal,first.principal);
 assert.throws(()=>f.authority.authenticate(first.sessionToken),OperatorSessionError);assert.throws(()=>f.authority.login(nextCode),error('operator_code_unavailable'));
 assert.equal(f.authority.authorize(second.sessionToken,kind).guard(),undefined);
 const revocation=f.authority.revoke();assert.ok(revocation.generation>second.generation);
});

test('invalid or unsafe configuration and clocks fail closed without consuming a valid boot code',()=>{
 for(const config of [{},{bootCode},{bootCode,operatorId:''},{bootCode,operatorId:' operator'},{bootCode,operatorId:'x',ttlMs:0},{bootCode,operatorId:'x',ttlMs:OPERATOR_SESSION_MAX_TTL_MS+1},{bootCode,operatorId:'x',allowedKinds:[kind,kind]},{bootCode,operatorId:'x',allowedKinds:['*']},{bootCode,operatorId:'x',clock:null}])assert.throws(()=>createOperatorSessionAuthority(config),TypeError);
 const f=fixture();f.setTime(NaN);assert.throws(()=>f.authority.login(bootCode),error('operator_clock_invalid'));f.setTime(Number.MAX_SAFE_INTEGER);assert.throws(()=>f.authority.login(bootCode),error('operator_clock_invalid'));
 f.setTime(1000);const login=f.authority.login(bootCode),guard=f.authority.authorize(login.sessionToken,kind).guard;f.setTime(Infinity);assert.throws(guard,error('operator_clock_invalid'));
 const before=fixture();before.authority.revoke();assert.throws(()=>before.authority.login(bootCode),error('operator_code_unavailable'));
});

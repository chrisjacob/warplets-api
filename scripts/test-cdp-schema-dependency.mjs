import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import test from 'node:test';
const appRequire=createRequire(new URL('../app/package.json',import.meta.url));
const baseRequire=createRequire(appRequire.resolve('@base-org/account'));
const sdkPath=baseRequire.resolve('@coinbase/cdp-sdk'),sdkRequire=createRequire(sdkPath);
const evm=sdkRequire(join(dirname(sdkPath),'policies/evmSchema.js'));
const sol=sdkRequire(join(dirname(sdkPath),'policies/solanaSchema.js'));
const policy=sdkRequire(join(dirname(sdkPath),'policies/types.js'));
test('CDP uses patched Zod and initializes its exported SDK',()=>{
 assert.equal(sdkRequire('zod/package.json').version,'4.6.6');
 assert.equal(typeof baseRequire('@coinbase/cdp-sdk').CdpClient,'function');
});
test('real CDP EVM, Solana and policy schemas preserve valid and invalid inputs',()=>{
 const address='0x'+'1'.repeat(40);
 const criterion={type:'evmAddress',addresses:[address],operator:'in'};
 assert.deepEqual(evm.EvmAddressCriterionSchema.parse(criterion),criterion);
 assert.equal(evm.EvmAddressCriterionSchema.safeParse({...criterion,addresses:['invalid']}).success,false);
 assert.equal(evm.EvmAddressCriterionSchema.safeParse({...criterion,addresses:Array(301).fill(address)}).success,false);
 const solCriterion={type:'solValue',solValue:'1000',operator:'<='};
 assert.deepEqual(sol.SolValueCriterionSchema.parse(solCriterion),solCriterion);
 assert.equal(sol.SolValueCriterionSchema.safeParse({...solCriterion,solValue:'-1'}).success,false);
 const body={scope:'account',description:'Local compatibility check',rules:[{action:'accept',operation:'signEvmTransaction',criteria:[{type:'ethValue',ethValue:'1000',operator:'<='}]}]};
 assert.deepEqual(policy.CreatePolicyBodySchema.parse(body),body);
 assert.equal(policy.CreatePolicyBodySchema.safeParse({...body,rules:[]}).success,false);
 assert.equal(policy.CreatePolicyBodySchema.safeParse({...body,rules:Array(11).fill(body.rules[0])}).success,false);
});
test('Quick Auth JWT/SIWF request schemas preserve validation and defaults',async()=>{
 const jwt=await import(new URL('../app/node_modules/@farcaster/quick-auth/dist/endpoints/verifyJwt.js',import.meta.url));
 const siwf=await import(new URL('../app/node_modules/@farcaster/quick-auth/dist/endpoints/verifySiwf.js',import.meta.url));
 assert.deepEqual(jwt.requestQueryParametersSchema.parse({token:'synthetic',domain:'app.10x.meme'}),{token:'synthetic',domain:'app.10x.meme'});
 assert.equal(jwt.requestQueryParametersSchema.safeParse({token:42,domain:'app.10x.meme'}).success,false);
 assert.deepEqual(siwf.requestBodySchema.parse({message:'synthetic',domain:'app.10x.meme',signature:'0x00'}),{message:'synthetic',domain:'app.10x.meme',signature:'0x00',acceptAuthAddress:true});
 assert.equal(siwf.requestBodySchema.safeParse({message:'synthetic',domain:'app.10x.meme',signature:null}).success,false);
});

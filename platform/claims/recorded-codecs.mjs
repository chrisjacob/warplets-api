/** Offline shape codecs supported by the retained Rewards/Core replay scripts.
 * They do not construct instructions, derive authorities, hash Merkle trees,
 * verify chain state or authorize a claim. */
export const RECORDED_CLAIM_SOURCES=Object.freeze([
 Object.freeze({path:'platform/lab/replay-rewards.mjs',commit:'dbfd2dbe4f99b0d5e6defe7117d2adffb7e08e35',digest:'19085579c6e237aeddd296f84317b08c9a59f85fae43858d6111f5c08045b6d4'}),
 Object.freeze({path:'platform/lab/replay-core-vault.mjs',commit:'bee8e1de2f533befdbda313fd04aa5c516fd841f',digest:'e213da0410badb1ffda1853dab1205c8ced6d2c809484b9dfb56eb4e26f74ec9'}),
 Object.freeze({path:'platform/lab/fixtures/rewards-program.json',commit:'81ce78cf18456e20a2fcfa990136014e744972fb',digest:'984ead8c1fece37d00166f2bf804e9ebced20ef3c9febad107d093b8c7433697'}),
]);
export const REWARDS_PROGRAM='REWArDioXgQJ2fZKkfu9LCLjQfRwYWVVfsvcsR5hoXi';
export const REWARDS_ROOT_FORMAT='foundation-rewards.keccak256.sorted-pairs.v1';
const need=(ok,why)=>{if(!ok)throw new TypeError('Recorded claim: '+why);};
const uint=(s,max=(1n<<64n)-1n)=>{need(typeof s==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(s),'canonical integer');const n=BigInt(s);need(n<=max,'integer range');return n;};
const exact=(v,keys)=>need(v&&Object.getPrototypeOf(v)===Object.prototype&&Reflect.ownKeys(v).length===keys.length&&keys.every(k=>{const d=Object.getOwnPropertyDescriptor(v,k);return d?.enumerable&&Object.hasOwn(d,'value');}),'exact data fields');
const publicKey=s=>need(typeof s==='string'&&/^[a-f0-9]{64}$/.test(s),'32-byte public identity hex');
const unhex=s=>Uint8Array.from(s.match(/../g),b=>parseInt(b,16));
const hex=b=>[...b].map(v=>v.toString(16).padStart(2,'0')).join('');
function linear(value){exact(value,['kind','startsAtSeconds','endsAtSeconds']);need(value.kind==='linear','only retained linear schedule is supported');const start=uint(value.startsAtSeconds,(1n<<63n)-1n),end=uint(value.endsAtSeconds,(1n<<63n)-1n);need(end>start,'positive schedule interval');return {start,end};}
export function encodeRecordedLinearSchedule(value){const {start,end}=linear(value),bytes=new Uint8Array(17),view=new DataView(bytes.buffer);bytes[0]=1;view.setBigUint64(1,start,true);view.setBigUint64(9,end,true);return bytes;}
export function decodeRecordedLinearSchedule(input){need(input instanceof Uint8Array&&input.length===17,'17-byte schedule');const bytes=Uint8Array.from(input),view=new DataView(bytes.buffer);need(bytes[0]===1,'unsupported vesting tag');const value={kind:'linear',startsAtSeconds:String(view.getBigUint64(1,true)),endsAtSeconds:String(view.getBigUint64(9,true))};linear(value);return Object.freeze(value);}
export function encodeRecordedLeafPayload(input){exact(input,['claimantHex','amountUnits','schedule']);const {claimantHex,amountUnits,schedule}=input;publicKey(claimantHex);const amount=uint(amountUnits),encoded=encodeRecordedLinearSchedule(schedule),bytes=new Uint8Array(57);bytes.set(unhex(claimantHex));new DataView(bytes.buffer).setBigUint64(32,amount,true);bytes.set(encoded,40);return bytes;}
export function decodeRecordedLeafPayload(input){need(input instanceof Uint8Array&&input.length===57,'57-byte linear leaf payload');const bytes=Uint8Array.from(input);return Object.freeze({claimantHex:hex(bytes.subarray(0,32)),amountUnits:String(new DataView(bytes.buffer).getBigUint64(32,true)),schedule:decodeRecordedLinearSchedule(bytes.subarray(40))});}
/** Distribution and mint are envelope/account context: they are NOT fields in
 * the retained leaf hash preimage. Never infer that arbitrary supplied context
 * is cryptographically bound by this shape decoder. */
export function inspectRecordedClaim(input){
 exact(input,['program','rootFormat','rootHex','distributionHex','mintHex','claimantType','assetHex','payload']);
 need(input.program===REWARDS_PROGRAM&&input.rootFormat===REWARDS_ROOT_FORMAT,'unsupported program/root format; Earn SHA-256 archives are not Rewards proofs');
 for(const key of ['rootHex','distributionHex','mintHex'])publicKey(input[key]);
 need(['wallet-bound','asset-signer'].includes(input.claimantType),'claimant type');
 if(input.claimantType==='asset-signer')publicKey(input.assetHex);else need(input.assetHex===null,'wallet leaf has no asset identity');
 const leaf=decodeRecordedLeafPayload(input.payload);
 return Object.freeze({program:input.program,rootFormat:input.rootFormat,rootHex:input.rootHex,distributionHex:input.distributionHex,mintHex:input.mintHex,claimantType:input.claimantType,assetHex:input.assetHex,leaf,
  evidence:'retained-replay-wire-shape',proofStatus:'missing-frozen-leaf-root-proof-vectors',distributionAndMintBinding:'unverified-account-context',signerDerivation:input.claimantType==='asset-signer'?'unverified':'not-applicable',
  policy:'nonrevocable-and-max-i64-clawback-candidate-unverified',permanentFlag:false,currentOwnerVerified:false,financialExecution:false,isAuthorization:false});
}
export async function verifyRecordedClaimSources({readSource,crypto}){for(const source of RECORDED_CLAIM_SOURCES){const raw=await readSource(source.path);need(raw instanceof Uint8Array&&raw.length<=65536,'bounded source');const bytes=Uint8Array.from(raw);need(await crypto.sha256(bytes)===source.digest,'retained source mismatch');}return Object.freeze({status:'pinned-source-bytes',proofVectors:'missing',sourceToBinaryParity:'unverified',financialExecution:false});}

import {createGovernancePlanning} from '../application/collection-governance.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
export const PUBLISH_BALLOT='governance.publish-ballot.v1',RECORD_DECISION='governance.record-decision.v1';
const publicationKeys=['ballotId','opensMs','previousTrancheOpeningMs','electorateSourceId','electorateDigest','cutoffMs','sourceKind','holdersListId','nextWhitelistListId','unionListId'];
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const requireValue=(condition,message)=>{if(!condition)throw new TypeError(message);};
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
export function governanceOperatorCommandBytes(command){return utf8(canonicalJson([command.operationKind,command.principal,command.input]));}
export async function prepareGovernanceOperatorCommand(kind,args,crypto){
 const c=structuredClone(args),planning=createGovernancePlanning({crypto});let pure;
 if(kind===PUBLISH_BALLOT){
  requireValue(exact(c.input,publicationKeys),'Supply the exact compact electorate binding.');
  requireValue(c.input.sourceKind==='synthetic-local-operator-fixture'&&c.input.cutoffMs===c.input.opensMs&&[c.input.holdersListId,c.input.nextWhitelistListId,c.input.unionListId].every(digest),'Invalid synthetic electorate source binding.');
  const {ballotId,opensMs,previousTrancheOpeningMs,electorateSourceId,electorateDigest}=c.input;
  pure=await planning.publishBallot({...c,input:{ballotId,opensMs,previousTrancheOpeningMs,electorateSourceId,electorateDigest}});
 }else{requireValue(kind===RECORD_DECISION,'Unknown governance operator command.');pure=await planning.recordDecision(c);}
 const command={...pure,input:c.input};return freeze({...command,requestDigest:await crypto.sha256(governanceOperatorCommandBytes(command))});
}
/** Command-only advisory records. This service has no HTTP route, stage opening
 * authority, payment capability or claim of externally verified ownership. */
export function createGovernanceOperatorService({repository,crypto,clock}){
 async function run(kind,principal,request){
  const p=structuredClone(principal),r=structuredClone(request);
  requireValue(r&&typeof r==='object'&&!Array.isArray(r)&&Object.keys(r).every(key=>['input','requestKey','expectedRevisions'].includes(key)),'Supply input and command metadata only.');
  const command=await prepareGovernanceOperatorCommand(kind,{principal:p,input:r.input,requestKey:r.requestKey,expectedRevisions:r.expectedRevisions??{},nowMs:clock.nowMs()},crypto);
  return kind===PUBLISH_BALLOT?repository.publishBallot(command):repository.recordDecision(command);
 }
 return Object.freeze({publishBallot:(principal,request)=>run(PUBLISH_BALLOT,principal,request),recordDecision:(principal,request)=>run(RECORD_DECISION,principal,request)});
}

import {useEffect,useRef,useState} from 'react';
import {z} from 'zod';
import {client} from './sdk';
import {useCapability} from './capabilities';
import type {Receipt} from './models';
import {Signal,utc} from './common';
export function CollectionOperationHold({operation}:{operation:Receipt}){
 return operation.reconciliation?<Signal>Held after an observed transfer; no fulfillment recorded. Earliest observed transfer: {utc(operation.reconciliation.observedAt)}. The original request remains awaiting evidence.</Signal>:null;
}

const hash=z.string().regex(/^[a-f0-9]{64}$/),traits=z.object({model:z.string(),backdrop:z.string(),symbol:z.string()}).strict(),drawBase={operationId:z.string(),commitment:z.string(),proofId:hash,at:z.number().int(),finalized:z.literal(true)};
const choices=z.array(z.object({name:z.string(),weight:z.number().int()}).strict()).max(256);
const transcript=z.object({format:z.literal('10x.recorded-draw-transcript.v1'),verificationScope:z.literal('recorded-beacon-draw-only'),requestPreimage:z.array(z.union([z.string(),z.number().int()])).length(9),contextDigest:hash,policyHash:hash,publicTraitChoices:z.object({model:choices,backdrop:choices,symbol:choices}).strict().nullable(),proof:z.object({chain:z.string(),round:z.number().int(),signature:z.string(),randomness:z.string()}).strict(),fixture:z.union([z.object({...drawBase,traits,ticket:z.number().int(),assetId:z.string()}).strict(),z.object({...drawBase,ticket:z.number().int().min(0).max(999)}).strict(),z.object({...drawBase,traits}).strict()]),selectedAssignment:z.object({assetId:z.string(),level:z.number().int().nullable()}).strict(),remainingQuotas:z.array(z.number().int().nonnegative()).length(10).nullable(),reservedAssetMapping:z.literal('withheld'),policyClosure:z.literal('requires-trusted-retained-policy'),productionOrderAndCustody:z.literal('unverified'),digest:hash}).strict();
const base={format:z.literal('10x.local.fairness.v1'),source:z.literal('local-fixture'),providerStatus:z.literal('candidate-unselected'),requiresVerifiedRepository:z.literal(true),requestState:z.enum(['waiting','assigned','held']),evidenceState:z.enum(['manual-fixture','retained-unverified','conflicted','verified','waiting-prior-admission','waiting-entropy','waiting-fulfillment']),financialState:z.literal('not-applicable-local'),commitment:hash,financialExecution:z.literal(false),serverSigning:z.literal(false),broadcast:z.literal(false)};
const fairness=z.discriminatedUnion('disclosure',[z.object({...base,disclosure:z.literal('sealed'),transcript:z.null()}).strict(),z.object({...base,disclosure:z.literal('revealed'),transcript}).strict()]);
export function CollectionOperationFairness({operation,wallet}:{operation:Receipt;wallet:string}){
 const capability=useCapability('GET','/api/v1/collect/me/operations/{id}/fairness'),identity=JSON.stringify([wallet,operation.id,operation.status,operation.assetId]),active=useRef<AbortController|null>(null),sequence=useRef(0);
 const [view,setView]=useState<{identity:string;value:z.infer<typeof fairness>}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{active.current?.abort();sequence.current++;setView(null);setError('');setBusy(false);return()=>{active.current?.abort();sequence.current++;};},[identity,capability.allowed]);
 const load=async()=>{active.current?.abort();const controller=new AbortController();active.current=controller;const serial=++sequence.current;setView(null);setError('');setBusy(true);try{const result=await client.readMyCollectionFairness({path:{id:operation.id},signal:controller.signal});const parsed=fairness.parse(result.data);if(serial===sequence.current&&!controller.signal.aborted)setView({identity,value:parsed});}catch(e){if(serial===sequence.current&&!controller.signal.aborted)setError(e instanceof Error?e.message:'Fairness evidence is unavailable.');}finally{if(serial===sequence.current)setBusy(false);}};
 if(operation.owner!==wallet)return null;
 if(!capability.allowed)return <p>Fairness verification is unavailable in this runtime.</p>;
 const value=view?.identity===identity?view.value:null;
 return <section aria-label="Recorded fairness"><h4>Recorded fairness</h4><p>Local fixture evidence only. Financial execution is not applicable. Provider selection and production custody remain unverified.</p>
  <button type="button" onClick={()=>void load()} disabled={busy}>{busy?'Checking retained evidence…':value?'Refresh fairness evidence':'Inspect fairness evidence'}</button>
  {error&&<Signal>{error}</Signal>}{value&&<><p>Request: {value.requestState}. Evidence: {value.evidenceState}.</p><p className="wrap-anywhere">Opaque commitment: {value.commitment}</p>
  {value.disclosure==='sealed'?<p>Transcript sealed. Assignment and all required reveal evidence must be retained before disclosure.</p>:<><p>Recorded draw verified. This does not verify the complete policy, production ordering or custody. Reserved future assets are withheld.</p><details><summary>Inspect revealed transcript</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(value.transcript,null,2)}</pre></details></>}</>}
 </section>;
}

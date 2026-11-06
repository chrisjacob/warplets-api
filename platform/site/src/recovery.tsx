import { useRuntimeQuery } from './capabilities';
import { useState } from 'react';
import { z } from 'zod';
import { client } from './sdk';
import { Facts, Loaded } from './common';

const result=z.object({data:z.object({id:z.string(),action:z.string(),subject:z.string(),
  state:z.enum(['validated','awaiting_signature','attempt_expired','submitted','unknown','confirmed','failed','finalized']),
  revision:z.number().int(),planHash:z.string(),attemptId:z.string().nullable(),source:z.literal('local-rehearsal'),
  provenance:z.literal('legacy-recorded-unverified'),executable:z.literal(false),financialExecution:z.literal(false),
  nextLocalTransition:z.enum(['prepare-recorded-packet','observe-or-expire-unsubmitted','replace-expired-unsubmitted','reconcile-existing-attempt','none']),
  requiredObservation:z.enum(['fresh-verified-preparation','recorded-block-height-or-submission','same-attempt-recorded-outcome']).nullable(),
  replacementEligible:z.boolean(),asOfMs:z.number().int(),attemptCount:z.number().int().nonnegative()})});
const guidance:Record<string,string>={
  validated:'The legacy plan is recorded. No attempt has been prepared.',
  awaiting_signature:'An unsigned packet is recorded. No signature or submission is established by this state.',
  submitted:'Submission is recorded. Reconcile the existing attempt; do not create a replacement.',
  unknown:'The original attempt has an unknown outcome. Reconciliation only; do not create a replacement.',
  confirmed:'Confirmation is recorded. Reconcile the existing attempt until its final outcome is established.',
  finalized:'Finality is recorded in this legacy rehearsal. It is not independently verified chain finality.',
  failed:'Failure is recorded. This read does not authorize a new attempt.',
  attempt_expired:'The recorded unsubmitted attempt expired. Replacement remains subject to the original intent and fresh verified preparation.',
};
const transitions:Record<string,string>={
  'prepare-recorded-packet':'Fresh verified preparation is required before another local step.',
  'observe-or-expire-unsubmitted':'Observe the original attempt or establish its unsubmitted expiry.',
  'replace-expired-unsubmitted':'Eligible for local replacement review only; no replacement is executed here.',
  'reconcile-existing-attempt':'Reconcile the existing attempt only.',
  none:'No further local transition is available from this read.',
};
const observations:Record<string,string>={
  'fresh-verified-preparation':'Fresh verified preparation',
  'recorded-block-height-or-submission':'Recorded block height or submission evidence',
  'same-attempt-recorded-outcome':'Recorded outcome for the same attempt',
};

export function Recovery({wallet}:{wallet:string}){
  const [draft,setDraft]=useState(''),[identifier,setIdentifier]=useState('');
  const receipt=useRuntimeQuery('/api/v1/transactions/{id}',{queryKey:['private',wallet,'solana','transaction',identifier],enabled:!!identifier,
    queryFn:async({signal})=>result.parse(await client.getTransaction({path:{id:identifier},signal})).data});
  return <details className="recovery"><summary>Find a transaction receipt</summary>
    <form className="member-form" onSubmit={event=>{event.preventDefault();setIdentifier(draft.trim());}}>
      <label>Transaction ID<input required value={draft} onChange={event=>setDraft(event.target.value)} maxLength={128}/></label>
      <button>Find receipt</button></form>
    {identifier && <Loaded query={receipt}>{r=><>
      <h3>{r.action} · {r.state}</h3><p>{guidance[r.state]}</p>
      <p>Legacy recorded evidence is unverified. This read-only guidance does not authorize signing, submission or payment.</p>
      <p>{transitions[r.nextLocalTransition]}</p>
      <Facts items={[['ID',r.id],['Subject',r.subject],['Attempt',r.attemptId??'Not yet prepared'],['Revision',r.revision],['Recorded attempts',r.attemptCount],
        ['Required evidence',r.requiredObservation?observations[r.requiredObservation]:'None identified by this read'],
        ['Replacement review',r.replacementEligible?'Eligible for local review only':'Not eligible'],
        ['Observed at',new Date(r.asOfMs).toISOString()],['Financial execution','Disabled']]}/>
      <button type="button" onClick={()=>void receipt.refetch()} disabled={receipt.isFetching}>Refresh receipt</button>
    </>}</Loaded>}
  </details>;
}

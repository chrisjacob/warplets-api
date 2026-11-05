import { useRuntimeQuery } from './capabilities';
import { useState } from 'react';
import { z } from 'zod';
import { client } from './sdk';
import { Facts, Loaded } from './common';

const result=z.object({data:z.object({id:z.string(),action:z.string(),subject:z.string(),state:z.string(),
  revision:z.number().int(),planHash:z.string(),attemptId:z.string().nullable(),source:z.literal('local-rehearsal'),
  executable:z.literal(false)})});
const guidance:Record<string,string>={
  validated:'The approved plan is recorded. No attempt has been submitted.',
  prepared:'A packet is ready in the local rehearsal.',
  submitted:'An attempt has been recorded and is awaiting a receipt.',
  unknown:'Awaiting evidence for the original attempt. Check this receipt again before taking any further action.',
  confirmed:'The attempt was observed. Final confirmation is pending.',
  finalized:'The attempt reached finality in the local rehearsal.',
  failed:'The attempt failed. Review its evidence before preparing a new attempt.',
  expired:'The packet lifetime ended. Review the original attempt before any replacement.',
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
      <h3>{r.action} · {r.state}</h3><p>{guidance[r.state]??'The current state comes from the local transaction ledger.'}</p>
      <Facts items={[['ID',r.id],['Subject',r.subject],['Attempt',r.attemptId??'Not yet prepared'],['Revision',r.revision]]}/>
      <button type="button" onClick={()=>void receipt.refetch()} disabled={receipt.isFetching}>Refresh receipt</button>
    </>}</Loaded>}
  </details>;
}

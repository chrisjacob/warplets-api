import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { client } from './sdk';
import { Empty, friendlyError, intentKey, Loaded, utc } from './common';

const topic=z.enum(['launch','voting','rewards']);
type Topic=z.infer<typeof topic>;
const preference=z.object({channel:z.literal('local-inbox'),revision:z.number().int(),enabled:z.boolean(),
  topics:z.array(topic),terms:z.literal('10x-notice-local-inbox-v1')});
const capabilities=z.object({data:z.object({channel:z.literal('local-inbox'),topics:z.array(topic),dailyLimit:z.number().int(),
  terms:z.literal('10x-notice-local-inbox-v1'),externalTransport:z.literal(false)})});
const inbox=z.object({items:z.array(z.object({id:z.string(),title:z.string(),message:z.string(),target:z.string(),deliveredMs:z.number()})),
  nextCursor:z.union([z.number(),z.string(),z.null()])});
const labels:Record<Topic,string>={launch:'Market launches',voting:'Genesis votes',rewards:'Reward updates'};
function safeTarget(raw:string){
  try{const url=new URL(raw,location.origin);
    return url.origin===location.origin && /^(\/markets|\/collections\/genesis|\/earn)(\/|$)/.test(url.pathname)
      ?url.pathname+url.search:null;}catch{return null;}
}
function InboxSettings({pref,topics,wallet}:{pref:z.infer<typeof preference>;topics:Topic[];wallet:string}){
  const cache=useQueryClient(),[selected,setSelected]=useState<Topic[]>(pref.topics);
  const change=useMutation({mutationFn:async(enabled:boolean)=>{
    const body={channel:pref.channel,terms:pref.terms,enabled,topics:enabled?selected:[],expectedRevision:pref.revision};
    const key=intentKey(wallet,'local-notice-consent',body);
    await client.setMyNoticePreferences({idempotencyKey:key.key,body});
    key.done();
  },onSuccess:()=>cache.invalidateQueries({queryKey:['private',wallet,'notifications']})});
  return <form className="member-form" onSubmit={e=>{e.preventDefault();change.mutate(true);}}>
    <fieldset disabled={change.isPending}><legend>Topics</legend>
      {topics.map(t=><label className="check" key={t}><input type="checkbox" checked={selected.includes(t)}
        onChange={e=>setSelected(old=>e.target.checked?[...old,t]:old.filter(x=>x!==t))}/>{labels[t]}</label>)}</fieldset>
    <button disabled={change.isPending || !selected.length}>{pref.enabled?'Save topics':'Enable local inbox'}</button>
    {pref.enabled && <button type="button" disabled={change.isPending} onClick={()=>change.mutate(false)}>Turn off and clear inbox</button>}
    <output aria-live="polite">{change.error?friendlyError(change.error):''}</output>
  </form>;
}
export function Notifications({wallet}:{wallet:string}){
  const [opened,setOpened]=useState(false),[cursor,setCursor]=useState<string>();
  const caps=useQuery({queryKey:['notice-capabilities'],enabled:opened,queryFn:async({signal})=>
    capabilities.parse(await client.getNoticeCapabilities({signal})).data});
  const prefs=useQuery({queryKey:['private',wallet,'notifications','preferences'],enabled:opened,queryFn:async({signal})=>
    z.object({data:preference}).parse(await client.getMyNoticePreferences({signal})).data});
  const notices=useQuery({queryKey:['private',wallet,'notifications','inbox',cursor],enabled:opened && !!prefs.data?.enabled,
    queryFn:async({signal})=>inbox.parse(await client.getMyLocalNotices({query:{cursor},signal}))});
  return <details onToggle={e=>setOpened(e.currentTarget.open)}><summary>Local inbox settings</summary>
    {opened && <Loaded query={caps}>{c=><Loaded query={prefs}>{pref=><>
      <p>{pref.enabled?'Local inbox enabled.':'Local inbox off.'} Notices appear inside this preview. Daily maximum: {c.dailyLimit}.</p>
      <InboxSettings key={pref.revision} pref={pref} topics={c.topics} wallet={wallet}/>
      {pref.enabled && <Loaded query={notices}>{page=><>
        {page.items.length?<ul className="records">{page.items.map(n=><li key={n.id}><strong>{n.title}</strong><small>{utc(new Date(n.deliveredMs).toISOString())}</small>
          <p>{n.message}</p>{safeTarget(n.target) && <a href={safeTarget(n.target)!}>Open notice ↗</a>}</li>)}</ul>:<Empty title="No local notices"/>}
        {page.nextCursor!==null && <button onClick={()=>setCursor(String(page.nextCursor))}>Older notices</button>}
      </>}</Loaded>}</>}</Loaded>}</Loaded>}
  </details>;
}

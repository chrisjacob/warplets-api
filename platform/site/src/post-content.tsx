import {useState} from 'react';
import {z} from 'zod';
import {useCapability,useRuntimeQuery} from './capabilities';
import {Modal,Loaded,utc} from './common';
import {useSession} from './session';
import {supportedPost} from '../../earn/supported-post.mjs';
import './post-content.css';
const path='/api/v1/earn/submissions/{submissionId}/content';
const model=z.object({submissionId:z.string().max(128),status:z.enum(['captured','preview','unavailable','unsupported']),source:z.enum(['farcaster','x']).nullable(),canonicalUrl:z.string().max(2048).nullable(),text:z.string().max(32000).nullable(),author:z.string().max(256).nullable(),capturedAt:z.iso.datetime().nullable(),provenance:z.enum(['operator-capture','farcaster-public-api','x-oembed']).nullable(),textComplete:z.boolean(),mediaIncluded:z.literal(false),automatedScoringEnabled:z.literal(false),message:z.string().max(1000)});
function ContentDialog({submissionId,wallet,onClose}:{submissionId:string;wallet:string|null;onClose:()=>void}){
 const query=useRuntimeQuery(path,{queryKey:[wallet?'private':'public',wallet,'post-content',submissionId],retry:false,staleTime:30000,queryFn:async({signal})=>{
  const response=await fetch('/api/v1/earn/submissions/'+encodeURIComponent(submissionId)+'/content',{signal,credentials:wallet?'same-origin':'omit'});if(!response.ok)throw Error(response.status===404?'This post is not available to view.':'Post content could not be loaded. Please try again.');
  const raw=await response.json(),value=model.parse(raw.data??raw);if(value.submissionId!==submissionId)throw Error('Post did not match this submission.');
  if(value.canonicalUrl){const parsed=supportedPost(value.canonicalUrl);if(parsed.canonicalUrl!==value.canonicalUrl||parsed.source!==value.source)throw Error('Post source did not match.');}return value;
 }});
 return <Modal title="Post content" onClose={onClose}><Loaded query={query}>{post=><article className="post-preview">
  <header className="post-preview-header"><span className="post-source-chip">{post.source==='x'?'𝕏 · X':post.source==='farcaster'?'F · Farcaster':'Saved submission'}</span>{post.author&&<h3>{post.author}</h3>}</header>
  {post.text&&<blockquote className="post-preview-text">{post.text}</blockquote>}
  <footer className="post-preview-meta"><p role="status">{post.message}</p>{post.capturedAt&&<small>{post.status==='captured'?'Saved':'Read'} {utc(post.capturedAt)}</small>}
  {post.canonicalUrl&&<p><a href={post.canonicalUrl} target="_blank" rel="noreferrer noopener">Open original on {post.source==='x'?'X':'Farcaster'} →</a></p>}
  <p className="post-preview-note">Text preview only · Authorship and reward eligibility are reviewed separately.</p></footer>
 </article>}</Loaded></Modal>;
}
export function PostContent({submissionId,label='View post'}:{submissionId:string;label?:string}){
 const [open,setOpen]=useState(false),{wallet}=useSession(),support=useCapability('GET',path);if(!support.allowed)return null;
 return <><button type="button" onClick={()=>setOpen(true)}>{label}</button>{open&&<ContentDialog key={wallet??'public'} wallet={wallet} submissionId={submissionId} onClose={()=>setOpen(false)}/>}</>;
}

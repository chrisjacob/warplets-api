import {useCapability} from './capabilities';
import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {z} from 'zod';
import {Modal,Panel} from './common';
const preview=z.object({label:z.literal('SIMULATION — not an AI judgment'),simulation:z.literal(true),suggestedScore:z.number().min(0).max(10),scoreMaximum:z.literal(10),status:z.literal('ready-for-operator-review'),rubricVersion:z.string(),summary:z.string(),criteria:z.array(z.object({id:z.string(),label:z.string(),score:z.number().min(0).max(5),maximum:z.literal(5),rationale:z.string(),improvement:z.string()})).max(20),uncertainty:z.string(),appealAvailable:z.boolean(),financialExecution:z.literal(false)});
export function ReviewPreview(){
 const [open,setOpen]=useState(false),capability=useCapability('GET','/api/v1/qa/content-review');
 const q=useQuery({queryKey:['public','qa-content-review'],enabled:open&&capability.allowed,retry:false,queryFn:async({signal})=>{const r=await fetch('/api/v1/qa/content-review',{signal});if(!r.ok)throw Error('Sample feedback is not configured in this preview.');const value=await r.json();return preview.parse(value.data??value);}});
 return <Panel title="How content is reviewed"><p>A clear rubric helps make scoring consistent and feedback useful. Automated suggestions still need review and can be wrong; they do not guarantee an award.</p><button disabled={!capability.allowed} onClick={()=>setOpen(true)}>Preview scoring feedback</button>
 {open&&<Modal title="Sample scoring feedback" onClose={()=>setOpen(false)}><p>This example is separate from your submissions. It uses a deterministic simulation, not an AI model.</p>{q.isError?<p role="status">Sample feedback is not configured in this preview. No score has been assigned to your content.</p>:!q.data?<p role="status">Loading sample feedback…</p>:<><p className="fixture-label">{q.data.label}</p><h3>Suggested score: {q.data.suggestedScore} / {q.data.scoreMaximum}</h3><p>{q.data.summary}</p><p>Awaiting operator review · uncertainty: {q.data.uncertainty}</p><ul className="review-criteria">{q.data.criteria.map(c=><li key={c.id}><h4>{c.label} · {c.score}/{c.maximum}</h4><p>{c.rationale}</p><p><strong>To improve:</strong> {c.improvement}</p></li>)}</ul><p>Rubric: {q.data.rubricVersion}. {q.data.appealAvailable?'A review can be requested before a final decision.':''} No award or settlement is changed by this preview.</p></>}</Modal>}
 </Panel>;
}

const el=id=>document.getElementById(id),day=el('day'),state=el('state');
const STAFF='ops.configure-workload.v1',SCOPE='ops.change-scope.v1',journalKey='operator-command';
day.value=new Date().toISOString().slice(0,10);
let cursor=null,revision=0,status=null,config=null,busy=false,pending=null;
const msg=s=>{el('feedback').textContent=s;};
function element(tag,text){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;}
function save(){if(pending)sessionStorage.setItem(journalKey,JSON.stringify(pending));else sessionStorage.removeItem(journalKey);}
function reset(preserveAttempted=false){let retained=pending;try{retained??=JSON.parse(sessionStorage.getItem(journalKey));}catch{}if(!preserveAttempted||!retained?.attempted||retained.rejected)sessionStorage.removeItem(journalKey);revision++;status=null;config=null;pending=null;sessionStorage.removeItem('operator-session');el('staff').reset();el('scope-form').reset();el('preview-details').replaceChildren();el('login').hidden=false;el('workspace').hidden=true;el('queue').replaceChildren();el('capacity').textContent='';el('preview').hidden=true;}
async function api(path,body,extra={}){
 const token=sessionStorage.getItem('operator-session'),headers={...(body?{'content-type':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{}),...extra};
 const response=await fetch('/ops/'+path,{method:body?'POST':'GET',credentials:'omit',headers,body:body?JSON.stringify(body):undefined});
 const result=await response.json();if(token!==sessionStorage.getItem('operator-session'))throw Error('The operator session changed.');
 if(response.status===401)reset(true);
 if(!response.ok){const error=Error(result.error?.message??'Request failed.');error.status=response.status;throw error;}
 return result;
}
function review(row){
 const box=element('article');box.append(element('strong',row.tokenId),element('p',row.wallet));const link=element('a',row.url);
 try{const url=new URL(row.url);if(url.protocol==='https:'){link.href=url.href;link.target='_blank';link.rel='noreferrer noopener';}}catch{}
 box.append(link);if(row.contentScore!=null)box.append(element('p','Final score '+row.contentScore+' · '+row.reason));
 else box.append(element('p','Final moderation is unavailable in this console. Existing final decisions remain visible.'));
 return box;
}
function controls(){
 const locked=busy||!!pending?.attempted;
 el('staff-fields').disabled=locked||!status?.allowedKinds.includes(STAFF);el('scope-fields').disabled=locked||!status?.allowedKinds.includes(SCOPE);
 el('staff-permission').textContent=status?.allowedKinds.includes(STAFF)?'':'Staffing commands are unavailable for this session.';
 el('scope-permission').textContent=status?.allowedKinds.includes(SCOPE)?'':'Scope commands are unavailable for this session.';
 el('confirm').disabled=busy||!!pending?.rejected;el('discard').hidden=!!pending?.attempted&&!pending?.rejected;el('discard').textContent=pending?.rejected?'Discard rejected command':'Discard unsubmitted preview';
 el('confirm').textContent=pending?.attempted?'Retry exact command':'Confirm local change';
}
function renderPreview(){
 el('preview').hidden=!pending;el('preview-details').replaceChildren();if(!pending){controls();return;}
 const {preview,request,attempted}=pending,s=preview.summary,rows=request.operationKind===STAFF?
 [['UTC date',new Date(s.effectiveEpoch*86400000).toISOString().slice(0,10)],['Staffed minutes',s.staffedMinutes],['Seconds per review',s.secondsPerReview],['Admission limit',s.admissionLimit],['Calculated capacity',s.calculatedCapacity],['Reason',s.reason]]:
 [['Scope',s.scope],['Change',s.paused?'Pause new work':'Resume new work'],['Previous scope revision',s.previousRevision??'No previous change'],['Reason',s.reason],['Evidence reference',s.evidenceRef]];
 rows.push(['Configuration revisions',Object.entries(preview.expectedRevisions).map(([k,v])=>k+': '+v).join(' · ')],['Command digest',preview.requestDigest]);
 for(const [label,value] of rows)el('preview-details').append(element('dt',label),element('dd',String(value)));
 el('preview-state').textContent=pending.rejected?'The command was rejected. Discard it and create a new preview using current configuration.':attempted?'The outcome needs confirmation. Retry uses the saved body, key and preview digest.':'Review this exact local change before confirming.';
 controls();
}
async function refreshConfig(){
 const current=await api('config');config=current;
 const selected=el('scope').value;el('scope').replaceChildren(...current.scopes.map(s=>{const o=element('option',s.scope+(s.paused?' · paused':' · active'));o.value=s.scope;return o;}));
 if(current.scopes.some(s=>s.scope===selected))el('scope').value=selected;
 el('scope-current').textContent=current.scopes.map(s=>s.scope+': '+(s.paused?'paused':'active')).join(' · ');
}
async function refresh(next=false){
 const turn=++revision;
 try{const p=new URLSearchParams({date:day.value,state:state.value});if(next&&cursor)p.set('cursor',cursor);const data=await api('board?'+p);if(turn!==revision)return;
 const c=data.metrics.capacity;el('capacity').textContent=c.admitted+' admitted · '+c.remaining+' places available';
 const rows=data.queue.items??[];el('queue').replaceChildren(...(rows.length?rows.map(review):[element('p','No submissions in this queue.')]));cursor=data.queue.nextCursor;el('next').hidden=!cursor;
 }catch(e){msg(e.message);}
}
async function open(){
 try{status=await api('status');if(typeof status.principal?.id!=='string')throw Error('Operator identity unavailable.');el('login').hidden=true;el('workspace').hidden=false;await refreshConfig();
 const raw=sessionStorage.getItem(journalKey);if(raw){try{const saved=JSON.parse(raw);if(raw.length>16384||!saved.request||!saved.preview||saved.principalId!==status.principal.id||!status.allowedKinds.includes(saved.request.operationKind)||!/^[a-f0-9]{64}$/.test(saved.preview.requestDigest))throw Error();pending=saved;}catch{pending=null;save();}}
 renderPreview();await refresh();
 }catch(e){msg(e.message);el('login').elements.code.focus();}
}
async function preview(operationKind,input){
 if(busy||pending?.attempted)return;busy=true;controls();
 try{await refreshConfig();const request={operationKind,requestKey:crypto.randomUUID(),expectedRevisions:structuredClone(config.expectedRevisions),input};const result=await api('commands/preview',request);
 if(result.operationKind!==operationKind||result.requestKey!==request.requestKey||result.financialExecution!==false||!/^[a-f0-9]{64}$/.test(result.requestDigest))throw Error('Preview identity mismatch.');
 pending={principalId:status.principal.id,request,preview:result,attempted:false};save();renderPreview();msg('Preview ready. No change has been committed.');el('preview-title').focus();
 }catch(e){msg(e.message);}finally{busy=false;controls();}
}
el('login').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget;try{const session=await api('login',{code:form.elements.code.value});pending=null;sessionStorage.setItem('operator-session',session.sessionToken);form.reset();msg('');await open();}catch(e){msg(e.message);form.elements.code.focus();}};
el('staff').onsubmit=event=>{event.preventDefault();const f=event.currentTarget.elements;void preview(STAFF,{effectiveEpoch:Date.parse(day.value+'T00:00:00Z')/86400000,staffedMinutes:Number(f.staffedMinutes.value),secondsPerReview:Number(f.secondsPerReview.value),admissionLimit:Number(f.admissionLimit.value),reason:f.reason.value.trim()});};
el('scope-form').onsubmit=async event=>{event.preventDefault();const f=event.currentTarget.elements,scope=f.scope.value,paused=f.paused.value==='true',reason=f.reason.value.trim(),evidenceRef=f.evidenceRef.value.trim();try{await refreshConfig();const current=config.scopes.find(s=>s.scope===scope);if(!current)throw Error('Scope unavailable.');await preview(SCOPE,{scope,paused,previousRevision:current.revision,reason,evidenceRef});}catch(e){msg(e.message);}};
function changed(){if(pending&&!pending.attempted){pending=null;save();renderPreview();msg('Input changed. Create a new preview.');}}
el('staff').oninput=el('scope-form').oninput=changed;
el('confirm').onclick=async()=>{
 if(!pending||busy)return;busy=true;pending.attempted=true;save();renderPreview();const captured=pending;
 try{const result=await api('commands/execute',captured.request,{'x-operator-preview':captured.preview.requestDigest});
 if(result.kind==='pending'){msg('Command held: '+result.reason+'. Retry the saved command after the dependency is ready.');return;}
 if(!['committed','replayed'].includes(result.kind)||result.receipt?.requestDigest!==captured.preview.requestDigest||result.receipt?.operationKind!==captured.request.operationKind||result.receipt?.requestKey!==captured.request.requestKey)throw Error('Command response identity mismatch. The original request is retained.');
 pending=null;save();renderPreview();await refreshConfig();await refresh();msg('Local change '+(result.kind==='replayed'?'confirmed from its existing receipt.':'committed with an audit receipt.'));el('feedback').focus();
 }catch(e){if(pending===captured){if([400,403,409,422].includes(e.status)){pending.rejected=true;save();}msg(pending.rejected?'Command rejected: '+e.message+' Discard it before preparing a new command.':'Outcome not confirmed: '+e.message+' Retry the exact saved command.');renderPreview();}else msg(e.message);}
 finally{busy=false;controls();}
};
el('discard').onclick=()=>{if(pending?.attempted&&!pending?.rejected)return;pending=null;save();renderPreview();msg('Unsubmitted preview discarded.');};
el('logout').onclick=async()=>{try{await api('logout',{});reset();msg('Signed out. Start a new local session to continue.');el('login').elements.code.focus();}catch(e){msg(e.message);}};
day.onchange=()=>{changed();void refresh();};state.onchange=()=>refresh();el('next').onclick=()=>refresh(true);void open();

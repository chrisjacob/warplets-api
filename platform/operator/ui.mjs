const el=id=>document.getElementById(id),day=el('day'),state=el('state');
const STAFF='ops.configure-workload.v1',SCOPE='ops.change-scope.v1',REVIEW='earn.final-review.v1',STAGE='collection.publish-stage.v1',journalKey='operator-command';
day.value=new Date().toISOString().slice(0,10);
let cursor=null,revision=0,status=null,config=null,busy=false,pending=null;
const msg=s=>{el('feedback').textContent=s;};
function element(tag,text){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;}
function save(){if(pending)sessionStorage.setItem(journalKey,JSON.stringify(pending));else sessionStorage.removeItem(journalKey);}
function reset(preserveAttempted=false){let retained=pending;try{retained??=JSON.parse(sessionStorage.getItem(journalKey));}catch{}if(!preserveAttempted||!retained?.attempted||retained.rejected)sessionStorage.removeItem(journalKey);revision++;status=null;config=null;pending=null;sessionStorage.removeItem('operator-session');el('staff').reset();el('scope-form').reset();el('stage-form').reset();el('preview-details').replaceChildren();el('login').hidden=false;el('workspace').hidden=true;el('queue').replaceChildren();el('capacity').textContent='';el('preview').hidden=true;}
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
 else if(status?.allowedKinds.includes(REVIEW)){
  const form=element('form'),fields=element('fieldset');fields.dataset.reviewFields='true';fields.append(element('legend','Final content review'));
  for(const [name,label,type] of [['score','Score (0–10)','number'],['reason','Review reason','text'],['sourceRef','Review evidence reference','text']]){const wrapper=element('label',label),input=element('input');input.name=name;input.type=type;input.required=true;if(name==='score'){input.min='0';input.max='10';input.step='1';}else input.maxLength=256;wrapper.append(input);fields.append(wrapper);}
  fields.append(element('p','A confirmed final score cannot be edited. A score of 0 rejects content; held evidence is separate.'),element('button','Preview final review'));form.append(fields);
  form.oninput=changed;form.onsubmit=event=>{event.preventDefault();const f=form.elements;void preview(REVIEW,{submissionId:row.id,score:Number(f.score.value),reason:f.reason.value.trim(),sourceRef:f.sourceRef.value.trim()});};box.append(form);
 }else box.append(element('p','Final moderation is unavailable for this session. Existing final decisions remain visible.'));
 return box;
}
function controls(){
 const locked=busy||!!pending?.attempted;
 el('staff-fields').disabled=locked||!status?.allowedKinds.includes(STAFF);el('scope-fields').disabled=locked||!status?.allowedKinds.includes(SCOPE);el('stage-fields').disabled=locked||!status?.allowedKinds.includes(STAGE);el('stage-permission').textContent=status?.allowedKinds.includes(STAGE)?'':'Stage publication is unavailable for this session.';
 el('staff-permission').textContent=status?.allowedKinds.includes(STAFF)?'':'Staffing commands are unavailable for this session.';
 el('scope-permission').textContent=status?.allowedKinds.includes(SCOPE)?'':'Scope commands are unavailable for this session.';
 for(const fields of document.querySelectorAll('[data-review-fields]'))fields.disabled=locked||!status?.allowedKinds.includes(REVIEW);el('review-permission').textContent=status?.allowedKinds.includes(REVIEW)?'Final scores are immutable once committed.':'Final moderation is unavailable for this session.';
 el('confirm').disabled=busy||!!pending?.rejected||!!pending&&!pending.attempted&&!/^[a-f0-9]{64}$/.test(pending.preview.confirmationDigest??'');el('discard').hidden=!!pending?.attempted&&!pending?.rejected;el('discard').textContent=pending?.rejected?'Discard rejected command':'Discard unsubmitted preview';
 el('confirm').textContent=pending?.attempted&&!pending.preview.confirmationDigest?'Check original receipt':pending?.attempted?'Retry exact command':'Confirm local change';
}
function renderPreview(){
 el('preview').hidden=!pending;el('preview-details').replaceChildren();if(!pending){controls();return;}
 const {preview,request,attempted}=pending,s=preview.summary,rows=request.operationKind===STAFF?
 [['UTC date',new Date(s.effectiveEpoch*86400000).toISOString().slice(0,10)],['Staffed minutes',s.staffedMinutes],['Seconds per review',s.secondsPerReview],['Admission limit',s.admissionLimit],['Calculated capacity',s.calculatedCapacity],['Reason',s.reason]]:
 request.operationKind===STAGE?[['Inventory',s.inventoryId],['Stage',s.stageId],['Type','Whitelist'],['Publication time (server UTC)',new Date(s.publishedAt).toISOString()],['Opens (UTC)',new Date(s.opensAt).toISOString()],['Closes (UTC)',new Date(s.closesAt).toISOString()],['Price (lamports)',s.priceLamports],['Local cost estimate (lamports)',s.costLamports],['Allocation',s.allocation],['Wallet limit',s.walletLimit],['Sealed whitelist',s.eligibility.listId],['Eligible wallets',s.eligibility.count],['Terms digest',s.termsDigest],['Cost uncertainty',s.costUncertainty],['Finality','Published price, opening and whitelist cannot be edited.']]:
 request.operationKind===REVIEW?[['Submission',s.submissionId],['Final score',s.score],['Finality','This final decision cannot be edited.'],['Reason',s.reason],['Evidence reference',s.sourceRef]]:
 [['Scope',s.scope],['Change',s.paused?'Pause new work':'Resume new work'],['Previous scope revision',s.previousRevision??'No previous change'],['Reason',s.reason],['Evidence reference',s.evidenceRef]];
 rows.push(['Configuration revisions',Object.entries(preview.expectedRevisions).map(([k,v])=>k+': '+v).join(' · ')],['Receipt request digest',preview.requestDigest],['Confirmation digest',preview.confirmationDigest??'Legacy preview: confirmation unavailable']);
 for(const [label,value] of rows)el('preview-details').append(element('dt',label),element('dd',String(value)));
 el('preview-state').textContent=!preview.confirmationDigest?'This saved request uses an earlier preview format. Its outcome is retained. Check the original receipt without executing a new change.':pending.rejected?'The command was rejected. Discard it and create a new preview using current configuration.':attempted?'The outcome needs confirmation. Retry uses the saved body, key and preview digest.':'Review this exact local change before confirming.';
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
 const rows=data.queue.items??[];el('queue').replaceChildren(...(rows.length?rows.map(review):[element('p','No submissions in this queue.')]));cursor=data.queue.nextCursor;el('next').hidden=!cursor;el('evidence-status').textContent='Held pricing observations: '+data.metrics.evidence.heldObservations+'. Held evidence is separate from content rejection.';controls();
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
 try{await refreshConfig();if(operationKind===STAGE){if(!Number.isSafeInteger(config.nowMs))throw Error('Server publication time unavailable.');input={...input,publishedAt:config.nowMs};}const request={operationKind,requestKey:operationKind===REVIEW?input.submissionId:crypto.randomUUID(),expectedRevisions:structuredClone(config.expectedRevisions),input};const result=await api('commands/preview',request);
 if(result.kind==='pending'){pending=null;save();renderPreview();msg('Preview held: '+result.reason+'. No publication has been confirmed.');return;}
 if(operationKind===STAGE&&(!/^[a-f0-9]{64}$/.test(result.summary?.termsDigest??'')||result.summary?.eligibility?.kind!=='list'||result.summary.eligibility.listId!==input.eligibilityListId||!Number.isInteger(result.summary.eligibility.count)||result.summary.eligibility.count<0||result.summary.eligibility.count>10000||typeof result.summary.costUncertainty!=='string')||Object.entries(input).some(([key,value])=>result.summary?.[key]!==value)||Object.entries(request.expectedRevisions).some(([key,value])=>result.expectedRevisions?.[key]!==value)||operationKind===STAFF&&result.summary?.calculatedCapacity!==Math.min(input.admissionLimit,Math.floor(input.staffedMinutes*60/input.secondsPerReview))||result.operationKind!==operationKind||result.requestKey!==request.requestKey||result.financialExecution!==false||!/^[a-f0-9]{64}$/.test(result.requestDigest)||!/^[a-f0-9]{64}$/.test(result.confirmationDigest)||operationKind===REVIEW&&result.summary.final!==true)throw Error('Preview identity mismatch.');
 pending={principalId:status.principal.id,request,preview:result,attempted:false};save();renderPreview();msg('Preview ready. No change has been committed.');el('preview-title').focus();
 }catch(e){msg(e.message);}finally{busy=false;controls();}
}
el('login').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget;try{const session=await api('login',{code:form.elements.code.value});pending=null;sessionStorage.setItem('operator-session',session.sessionToken);form.reset();msg('');await open();}catch(e){msg(e.message);form.elements.code.focus();}};
el('staff').onsubmit=event=>{event.preventDefault();const f=event.currentTarget.elements;void preview(STAFF,{effectiveEpoch:Date.parse(day.value+'T00:00:00Z')/86400000,staffedMinutes:Number(f.staffedMinutes.value),secondsPerReview:Number(f.secondsPerReview.value),admissionLimit:Number(f.admissionLimit.value),reason:f.reason.value.trim()});};
el('scope-form').onsubmit=async event=>{event.preventDefault();const f=event.currentTarget.elements,scope=f.scope.value,paused=f.paused.value==='true',reason=f.reason.value.trim(),evidenceRef=f.evidenceRef.value.trim();try{await refreshConfig();const current=config.scopes.find(s=>s.scope===scope);if(!current)throw Error('Scope unavailable.');await preview(SCOPE,{scope,paused,previousRevision:current.revision,reason,evidenceRef});}catch(e){msg(e.message);}};
function utcTime(value){if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(value))throw Error('Enter an explicit UTC opening and closing time.');const ms=Date.parse(value+'Z');if(!Number.isSafeInteger(ms)||!new Date(ms).toISOString().startsWith(value))throw Error('Invalid UTC time.');return ms;}
el('stage-form').onsubmit=event=>{event.preventDefault();const f=event.currentTarget.elements;try{void preview(STAGE,{inventoryId:f.inventoryId.value.trim(),stageId:f.stageId.value.trim(),type:'whitelist',publishedAt:0,opensAt:utcTime(f.opensAt.value),closesAt:utcTime(f.closesAt.value),priceLamports:f.priceLamports.value.trim(),costLamports:f.costLamports.value.trim(),allocation:Number(f.allocation.value),walletLimit:Number(f.walletLimit.value),founderApproved:false,approvedSpendLamports:null,ballotId:null,inventoryOverrideReason:null,eligibilityListId:f.eligibilityListId.value.trim(),sourceKind:'synthetic-local-operator-fixture'});}catch(e){msg(e.message);}};
function changed(){if(pending&&!pending.attempted){pending=null;save();renderPreview();msg('Input changed. Create a new preview.');}}
el('staff').oninput=el('scope-form').oninput=el('stage-form').oninput=changed;
el('confirm').onclick=async()=>{
 if(!pending||busy)return;busy=true;pending.attempted=true;save();renderPreview();const captured=pending;
 try{const result=await api(captured.preview.confirmationDigest?'commands/execute':'commands/receipt',captured.request,captured.preview.confirmationDigest?{'x-operator-preview':captured.preview.confirmationDigest}:{});
 if(result.kind==='pending'){msg('Command held: '+result.reason+'. Retry the saved command after the dependency is ready.');return;}
 if(captured.request.operationKind===STAGE&&(result.value?.inventoryId!==captured.request.input.inventoryId||result.value?.stageId!==captured.request.input.stageId||result.value?.termsDigest!==captured.preview.summary.termsDigest||result.value?.eligibility?.kind!=='list'||result.value?.eligibility?.listId!==captured.preview.summary.eligibility.listId||result.value?.eligibility?.count!==captured.preview.summary.eligibility.count||result.value?.executable!==false)||!['committed','replayed'].includes(result.kind)||result.receipt?.requestDigest!==captured.preview.requestDigest||result.receipt?.operationKind!==captured.request.operationKind||result.receipt?.requestKey!==captured.request.requestKey)throw Error('Command response identity mismatch. The original request is retained.');
 pending=null;save();renderPreview();await refreshConfig();await refresh();msg('Local change '+(result.kind==='replayed'?'confirmed from its existing receipt.':'committed with an audit receipt.'));el('feedback').focus();
 }catch(e){if(pending===captured){if([400,403,409,422].includes(e.status)){pending.rejected=true;save();}msg(pending.rejected?'Command rejected: '+e.message+' Discard it before preparing a new command.':'Outcome not confirmed: '+e.message+(captured.preview.confirmationDigest?' Retry the exact saved command.':' The saved request remains held; checking its receipt cannot execute it.'));renderPreview();}else msg(e.message);}
 finally{busy=false;controls();}
};
el('discard').onclick=()=>{if(pending?.attempted&&!pending?.rejected)return;pending=null;save();renderPreview();msg('Unsubmitted preview discarded.');};
el('logout').onclick=async()=>{try{await api('logout',{});reset();msg('Signed out. Start a new local session to continue.');el('login').elements.code.focus();}catch(e){msg(e.message);}};
day.onchange=()=>{changed();void refresh();};state.onchange=()=>refresh();el('next').onclick=()=>refresh(true);void open();

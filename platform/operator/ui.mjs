const el=id=>document.getElementById(id);
const day=el('day'),state=el('state'),feedback=el('feedback');
day.value=new Date().toISOString().slice(0,10);
let cursor=null,revision=0;
const msg=s=>{feedback.textContent=s;};
async function api(path,body){
 const headers=body?{'content-type':'application/json'}:{};
 const token=sessionStorage.getItem('operator-session');
 if(token)headers.authorization='Bearer '+token;
 const response=await fetch('/ops/'+path,{method:body?'POST':'GET',credentials:'omit',headers,
  body:body?JSON.stringify(body):undefined});
 const result=await response.json();
 if(response.status===401){sessionStorage.removeItem('operator-session');el('login').hidden=false;el('workspace').hidden=true;el('queue').replaceChildren();el('capacity').textContent='';}
 if(!response.ok)throw Error(result.error?.message??'Request failed.');
 return result;
}
function element(tag,text){
 const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;
}
function review(row){
 const box=element('article');box.append(element('strong',row.tokenId),element('p',row.wallet));
 const link=element('a',row.url);
 try{const url=new URL(row.url);if(url.protocol==='https:'){link.href=url.href;link.target='_blank';link.rel='noreferrer noopener';}}catch{}
 box.append(link);
 if(row.contentScore!=null){box.append(element('p','Final score '+row.contentScore+' · '+row.reason));return box;}
 const form=element('form');
 const scoreLabel=element('label','Score (0–10)'),score=element('input');score.type='number';score.min='0';score.max='10';score.required=true;
 scoreLabel.append(score);const reasonLabel=element('label','Decision reason'),reason=element('input');reason.required=true;reason.maxLength=256;reasonLabel.append(reason);
 const submit=element('button','Publish final score');form.append(scoreLabel,reasonLabel,submit);
 form.onsubmit=async event=>{event.preventDefault();submit.disabled=true;try{
  await api('reviews',{submissionId:row.id,score:Number(score.value),reason:reason.value.trim(),final:true});await refresh();msg('Final decision recorded.');
 }catch(e){msg(e.message);}finally{submit.disabled=false;}};box.append(form);return box;
}
async function refresh(next=false){
 const turn=++revision;
 try{
  const p=new URLSearchParams({date:day.value,state:state.value});if(next&&cursor)p.set('cursor',cursor);
  const data=await api('board?'+p);
  if(turn!==revision)return;
  const capacity=data.metrics.capacity;
  el('capacity').textContent=capacity.admitted+' admitted · '+capacity.remaining+' places available';
  const rows=data.queue.items??[];el('queue').replaceChildren(...(rows.length?rows.map(review):[element('p','No submissions in this queue.')]));
  cursor=data.queue.nextCursor;el('next').hidden=!cursor;
 }catch(e){msg(e.message);}
}
async function open(){try{await api('status');el('login').hidden=true;el('workspace').hidden=false;await refresh();}catch(e){msg(e.message);}}
el('login').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget;try{
 const session=await api('login',{code:form.elements.code.value});sessionStorage.setItem('operator-session',session.sessionToken);form.reset();msg('');await open();
}catch(e){msg(e.message);}};
el('staff').onsubmit=async event=>{event.preventDefault();const f=event.currentTarget.elements;try{
 await api('capacity',{date:day.value,staffedMinutes:Number(f.staffedMinutes.value),secondsPerReview:Number(f.secondsPerReview.value),admissionLimit:Number(f.admissionLimit.value),reason:f.reason.value.trim()});
 await refresh();msg('Staffing updated.');
}catch(e){msg(e.message);}};
el('logout').onclick=async()=>{try{await api('logout',{});sessionStorage.removeItem('operator-session');location.reload();}catch(e){msg(e.message);}};
day.onchange=state.onchange=()=>refresh();el('next').onclick=()=>refresh(true);open();

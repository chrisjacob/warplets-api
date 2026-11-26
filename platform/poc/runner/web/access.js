const form=document.getElementById('unlock'),key=document.getElementById('key'),message=document.getElementById('access-message');
const incoming=new URLSearchParams(location.hash.slice(1)).get('access');
// The access key travels in the fragment, never in a request URL/referrer.
history.replaceState(null,'',location.pathname);
async function unlock(value) {
  form.querySelector('button').disabled=true;message.textContent='Opening private runner…';
  try {
    const response=await fetch('./unlock',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:value})});
    if(!response.ok)throw Error((await response.json()).error??'Access denied');
    key.value='';location.replace('./');
  }catch(error){message.textContent=error.message;form.querySelector('button').disabled=false;}
}
form.onsubmit=event=>{event.preventDefault();unlock(key.value.trim());};
if(incoming)await unlock(incoming);
else {
  // Strict cookies are withheld on an external first navigation, but may be
  // present on this same-origin request after the document loads.
  const response=await fetch('./api/state');if(response.ok)location.replace('./');
}

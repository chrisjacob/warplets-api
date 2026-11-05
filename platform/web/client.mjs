import { initWallet } from './wallet.mjs';
import { collectView, earnView, escapeHtml, marketsView, percent, stakeView, vaultView } from './views.mjs';

const view=document.querySelector('#view');
const resource=location.pathname==='/'?'markets':location.pathname.slice(1);
const params=new URLSearchParams(location.search);
const utcToday=new Date().toISOString().slice(0,10);
const requestedDate=params.get('date') ?? utcToday;
const date=/^\d{4}-\d{2}-\d{2}$/.test(requestedDate) && !isNaN(Date.parse(requestedDate))
  && new Date(requestedDate).toISOString().startsWith(requestedDate) ? requestedDate : utcToday;
for(const link of document.querySelectorAll('nav a')) {
  if(link.pathname==='/'+resource) link.setAttribute('aria-current','page');
}
document.title=resource[0].toUpperCase()+resource.slice(1)+' · 10X.MEME';

async function api(path,{method='GET',body}={}) {
  const response=await fetch('/api/v1'+path,{method,credentials:'same-origin',
    headers:body?{'content-type':'application/json'}:undefined,
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12_000)});
  if(!response.ok) {
    const value=await response.json().catch(()=>null);
    throw new Error(value?.error?.message ?? 'Request failed. Please try again.');
  }
  return response.json();
}
const optional=path=>api(path).catch(()=>null);
let data=null, me=null;
const wallet=initWallet({api,onSession:value=>{me=value;if(data) render()}});

function bindCurve(points) {
  const slider=document.querySelector('#curve-seconds');
  if(!slider) return;
  const first=points[0],last=points.at(-1), ceiling=Math.max(...points.map(p=>p.feeBps),1);
  slider.addEventListener('input',()=>{
    const p=points[Number(slider.value)];
    document.querySelector('#curve-value').textContent=percent(p.feeBps);
    document.querySelector('#curve-time').textContent=p.elapsedSeconds+' seconds';
    slider.setAttribute('aria-valuetext',p.elapsedSeconds+' seconds, '+percent(p.feeBps)+' fee');
    const marker=document.querySelector('#curve-marker');
    marker.setAttribute('cx',32+426*(p.elapsedSeconds-first.elapsedSeconds)/(last.elapsedSeconds-first.elapsedSeconds));
    marker.setAttribute('cy',114-96*p.feeBps/ceiling);
  });
}

function render() {
  const {policy,markets,schedule,collections,board}=data;
  if(resource==='markets') {
    view.innerHTML=marketsView({policy,markets,schedule,selectedId:params.get('market')});
    bindCurve(schedule?.points);
  } else if(resource==='collect') view.innerHTML=collectView({collections});
  else if(resource==='vault') view.innerHTML=vaultView({policy,me});
  else if(resource==='stake') view.innerHTML=stakeView({policy,markets});
  else if(resource==='earn') view.innerHTML=earnView({policy,board,date});
}

async function load() {
  const [policy,profile,markets,schedule,collections,board]=await Promise.all([
    api('/policy'), optional('/me'), ['markets','stake'].includes(resource)?optional('/markets'):null,
    resource==='markets'?optional('/launch/fee-schedule'):null,
    resource==='collect'?optional('/collections'):null,
    resource==='earn'?optional('/earn/epochs/'+date+'/leaderboard'):null]);
  wallet.session(profile?.wallet?profile:null);
  data={policy,markets,schedule,collections,board};
  render();
}
load().catch(()=>{view.innerHTML='<h1>'+escapeHtml(document.title.split(' · ')[0])
  +'</h1><p class="notice" role="status">Product information could not be loaded. Reload this page to try again.</p>'})
  .finally(()=>view.setAttribute('aria-busy','false'));

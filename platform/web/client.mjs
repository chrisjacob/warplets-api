import { initWallet } from './wallet.mjs';
import { collectView, earnView, escapeHtml, marketsView, percent, stakeView, vaultView } from './views.mjs';
import { earnActivity, farmActivity, ownerVaultPanel } from './activity.mjs';
import { bindStudio, studioMarkup } from './collection-studio.mjs';

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

async function api(path,{method='GET',body,idempotencyKey}={}) {
  const headers={};
  if(body) headers['content-type']='application/json';
  if(idempotencyKey) headers['idempotency-key']=idempotencyKey;
  const response=await fetch('/api/v1'+path,{method,credentials:'same-origin',
    headers,
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12_000)});
  if(!response.ok) {
    const value=await response.json().catch(()=>null);
    const error=new Error(value?.error?.message ?? 'Request failed. Please try again.');
    error.code=value?.error?.code;
    throw error;
  }
  return response.json();
}
const optional=path=>api(path).catch(()=>null);
let data=null, me=null, privateData={}, generation=0, submitIntent=null;
const assetId=params.get('asset');
const farmId=params.get('farm');
const cursor=value=>value?'?cursor='+encodeURIComponent(value):'';
let submissionFeedback='';
const wallet=initWallet({api,onSession:changeSession});
const collectionDialog=document.querySelector('#collection-dialog');
document.querySelector('#close-collection').addEventListener('click',()=>collectionDialog.close());
collectionDialog.addEventListener('close',()=>{
  document.querySelector('#collection-review').replaceChildren();
  document.querySelector('#collection-status').textContent='';
});

function changeSession(value) {
  me=value;
  privateData={};
  submitIntent=null;
  submissionFeedback='';
  if(collectionDialog.open) collectionDialog.close();
  generation++;
  if(data) {
    render();
    void loadPrivate();
  }
}

async function loadPrivate() {
  if(!me || !data || !['vault','earn','stake','collect'].includes(resource)) return;
  const current=++generation;
  privateData={loading:true};
  render();
  let results;
  if(resource==='vault') results={assets:await optional('/vault'+cursor(assetId?null:params.get('cursor')))};
  else if(resource==='stake') results={positions:await optional('/stake/positions'+cursor(params.get('cursor')))};
  else if(resource==='collect') {
    const [inventories,assets,operations,receipt]=await Promise.all([
      optional('/collect/inventories'+cursor(params.get('inventories'))),
      optional('/collect/me/assets'+cursor(params.get('owned'))),
      optional('/collect/me/operations'+cursor(params.get('operations'))),
      params.get('receipt')?optional('/collect/me/operations/'+encodeURIComponent(params.get('receipt'))):null]);
    results={inventories,assets,operations,receipt};
  }
  else {
    const [submissions,claims]=await Promise.all([
      optional('/earn/me'+cursor(params.get('submissions'))),optional('/earn/claims'+cursor(params.get('awards')))]);
    results={submissions,claims};
  }
  if(current!==generation) return;
  privateData=results;
  render();
}

function bindActions() {
  document.querySelectorAll('[data-connect]').forEach(button=>button.addEventListener('click',()=>{
    document.querySelector('#wallet-button').click();
  }));
  const form=document.querySelector('#submission-form');
  if(!form) return;
  const output=form.querySelector('output');output.textContent=submissionFeedback;
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    const fields=new FormData(form),body={tokenId:fields.get('tokenId'),url:fields.get('url')};
    const fingerprint=JSON.stringify([me?.wallet,body.tokenId,body.url]);
    if(submitIntent?.fingerprint!==fingerprint) submitIntent={fingerprint,key:crypto.randomUUID()};
    const walletAtSubmit=me?.wallet;
    form.querySelector('button').disabled=true;output.textContent='Checking contribution…';
    try {
      await api('/earn/submissions',{method:'POST',body,idempotencyKey:submitIntent.key});
      if(walletAtSubmit!==me?.wallet) return;
      submissionFeedback='Contribution recorded for moderation.';
      submitIntent=null;
      await loadPrivate();
    } catch (error) {
      output.textContent=error.message;
      form.querySelector('button').disabled=false;
    }
  });
}

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
  } else if(resource==='collect') {
    const inventories=privateData.inventories??data.inventories;
    view.innerHTML=collectView({collections})+studioMarkup({me,...privateData,inventories});
    const walletAtRender=me?.wallet;
    if(me && !privateData.loading) bindStudio({inventories,assets:privateData.assets,me,api,
      isCurrent:()=>walletAtRender===me?.wallet});
  }
  else if(resource==='vault') view.innerHTML=vaultView({policy,me})+ownerVaultPanel({me,...privateData,assetId,detail:data.detail});
  else if(resource==='stake') view.innerHTML=stakeView({policy,markets})+farmActivity({me,markets,farmId,farm:data.farm,...privateData});
  else if(resource==='earn') view.innerHTML=earnView({policy,board,date})+earnActivity({me,markets,...privateData,date});
  bindActions();
}

async function load() {
  const [policy,profile,markets,schedule,collections,board,detail,farm,inventories]=await Promise.all([
    api('/policy'), optional('/me'), ['markets','stake','earn'].includes(resource)?optional('/markets'):null,
    resource==='markets'?optional('/launch/fee-schedule'):null,
    resource==='collect'?optional('/collections'):null,
    resource==='earn'?optional('/earn/epochs/'+date+'/leaderboard'):null,
    resource==='vault' && assetId?optional('/nfts/'+encodeURIComponent(assetId)+'/vault'+cursor(params.get('cursor'))):null,
    resource==='stake' && farmId?api('/farms/'+encodeURIComponent(farmId)).catch(error=>error.code==='farm_not_found'?{missing:true}:null):null,
    resource==='collect'?optional('/collect/inventories'+cursor(params.get('inventories'))):null]);
  wallet.session(profile?.wallet?profile:null);
  data={policy,markets,schedule,collections,board,detail,farm,inventories};
  render();
  await loadPrivate();
}
load().catch(()=>{view.innerHTML='<h1>'+escapeHtml(document.title.split(' · ')[0])
  +'</h1><p class="notice" role="status">Product information could not be loaded. Reload this page to try again.</p>'})
  .finally(()=>view.setAttribute('aria-busy','false'));

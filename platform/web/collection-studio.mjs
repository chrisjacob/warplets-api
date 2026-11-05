import { escapeHtml } from './views.mjs';

const e=escapeHtml;
const panel=(heading,body)=>'<section class="card"><h2>'+e(heading)+'</h2>'+body+'</section>';
const date=value=>new Date(value).toISOString().slice(0,16).replace('T',' ')+' UTC';
export function sol(lamports) {
  if(!/^(0|[1-9]\d*)$/.test(String(lamports))) return 'Unavailable';
  const n=BigInt(lamports);
  const fraction=String(n%1_000_000_000n).padStart(9,'0').replace(/0+$/,'');
  return (n/1_000_000_000n).toString()+(fraction?'.'+fraction:'')+' SOL';
}
const pairs=entries=>'<dl class="breakdown">'+entries.map(([name,value])=>'<div><dt>'+e(name)+'</dt><dd>'+e(value)+'</dd></div>').join('')+'</dl>';
const more=(param,cursor,label)=>cursor==null?'':'<a class="text-link" href="/collect?'+param+'='+encodeURIComponent(cursor)+'">'+e(label)+' →</a>';

function stageMarkup(inventory,stage,me) {
  const hasCapacity=stage.status==='open' && stage.available>0;
  const available=hasCapacity && stage.eligible && stage.type!=='founder' && stage.walletReservations<stage.walletLimit;
  let action='';
  if(available) action='<button type="button" data-mint-inventory="'+e(inventory.id)+'" data-mint-stage="'+e(stage.id)+'">Review reservation</button>';
  else if(hasCapacity && !me && stage.type!=='founder') action='<button type="button" data-connect>Connect wallet</button>';
  else if(hasCapacity && me && !stage.eligible) action='<p>This wallet is outside the stage eligibility list.</p>';
  else if(hasCapacity && me && stage.walletReservations>=stage.walletLimit) action='<p>You have reached this stage’s wallet limit.</p>';
  if(stage.openingHold) action+='<p>'+e(stage.openingHold)+'</p>';
  return '<article class="studio-stage"><div class="entry-head"><h4>'+e(stage.id)+'</h4><span>'+e(stage.status)+'</span></div>'
    +pairs([['Mint price',sol(stage.priceLamports)],['Creation and network quote',sol(stage.costLamports)],
      ['Slots available',stage.available],['Limit per wallet',stage.walletLimit],['Opens',date(stage.opensAt)],['Closes',date(stage.closesAt)]])
    +action+'</article>';
}

function stagesPanel(inventories,me) {
  if(!inventories) return panel('Published stages','<p class="notice">Published stages could not be loaded.</p>');
  if(!inventories.items.length) return panel('Published stages','<p>No local mint stages have been published.</p>');
  const list=inventories.items.map(inv=>'<article class="inventory-group"><h3>'+e(inv.id)+'</h3>'
    +'<p>'+e(inv.counts.unsold)+' slots remain · '+e(inv.counts.pending)+' awaiting fulfillment · '+e(inv.counts.paid)+' paid mints</p>'
    +inv.stages.map(s=>stageMarkup(inv,s,me)).join('')+'</article>').join('');
  return panel('Published stages',list+more('inventories',inventories.nextCursor,'Next collections'));
}

function assetsPanel(assets) {
  if(!assets) return panel('Your collection','<p class="notice">Your collection could not be loaded.</p>');
  const items=assets.items.map(a=>{
    const common='<h3>'+e(a.id)+'</h3><p>'+e(a.inventoryId)+' · '+e(a.revealStatus)+'</p>';
    if(a.revealStatus!=='revealed') return '<article class="asset">'+common+'</article>';
    const meta=pairs([['Level',a.level],['Model',a.traits.model],['Backdrop',a.traits.backdrop],['Symbol',a.traits.symbol],
      ['Benefit expiry',a.expiresAt?date(a.expiresAt):'Permanent']]);
    let controls='';
    if(a.expiresAt && !a.operationPending) {
      controls='<div class="op-row"><button type="button" data-reroll="'+e(a.id)+'">Preview visual reroll</button></div>';
      if(a.level<10) controls+='<form class="member-form upgrade-form" data-upgrade="'+e(a.id)+'"><label>Same-Level material NFT ID'
        +'<input name="material" required maxlength="128" list="material-candidates"></label><button>Preview upgrade</button></form>';
    }
    return '<article class="asset">'+common+meta+(a.operationPending?'<p>Awaiting committed draw evidence.</p>':controls)
      +'<a class="text-link" href="/vault?asset='+encodeURIComponent(a.id)+'">Vault allocations ↗</a></article>';
  }).join('');
  const candidates=assets.items.filter(a=>a.revealStatus==='revealed' && a.expiresAt && !a.operationPending);
  return panel('Your collection','<datalist id="material-candidates">'+candidates.map(a=>'<option value="'+e(a.id)+'"></option>').join('')+'</datalist>'
    +(items||'<p>This wallet has no local collection assets.</p>')+more('owned',assets.nextCursor,'Next assets'));
}

function operationsPanel(operations,receipt) {
  if(!operations) return panel('Operation history','<p class="notice">Operation history could not be loaded.</p>');
  const rows=operations.items.map(op=>'<li><a href="/collect?receipt='+encodeURIComponent(op.id)+'"><strong>'+e(op.kind)
    +' · '+e(op.inventoryId)+'</strong><span>'+e(op.status)+' ↗</span></a></li>').join('');
  const details=receipt?'<article class="receipt"><h3>Operation receipt</h3>'+pairs([['ID',receipt.id],['State',receipt.status],
    ['Requested',date(receipt.createdAt)],['Action',receipt.kind],['Collection',receipt.inventoryId],
    ['Recorded price',sol(receipt.priceLamports??receipt.feeLamports)],['Result NFT',receipt.assetId??'Pending']])+'</article>':'';
  return panel('Operation history',details+(rows?'<ul class="market-list">'+rows+'</ul>':'<p>No operations for this wallet.</p>')
    +more('operations',operations.nextCursor,'Next operations'));
}

export function studioMarkup({inventories,me,assets,operations,receipt,loading}) {
  return stagesPanel(inventories,me)+(me?(loading?'<p role="status">Loading your collection…</p>'
    :assetsPanel(assets)+operationsPanel(operations,receipt)):'');
}

/** The browser retains an outstanding request key across reloads. If a response is
 * lost the next confirmation recovers the exact operation instead of reserving a
 * second slot. The wallet, stage and expected versions are part of the identity.
 */
function requestKey(wallet,path,body) {
  const name='10x.local.intent:'+JSON.stringify([wallet,path,body]);
  const key=sessionStorage.getItem(name)??crypto.randomUUID();
  sessionStorage.setItem(name,key);
  return {key,acknowledge:()=>sessionStorage.removeItem(name)};
}

export function bindStudio({inventories,assets,me,api,isCurrent}) {
  const dialog=document.querySelector('#collection-dialog');
  const body=document.querySelector('#collection-review');
  const status=document.querySelector('#collection-status');
  let reviewGeneration=0;
  const open=(title,html)=>{
    document.querySelector('#collection-title').textContent=title;
    status.textContent='';
    body.innerHTML=html;
    if(!dialog.open) dialog.showModal();
    return ++reviewGeneration;
  };
  const submit=(name,path,input)=>{
    const btn=document.createElement('button');btn.textContent=name;body.appendChild(btn);
    btn.addEventListener('click',async()=>{
      btn.disabled=true;status.textContent='Recording local operation…';
      try {
        if(!isCurrent()) throw new Error('Your session changed. Reopen this review.');
        const pending=requestKey(me.wallet,path,input);
        const result=await api(path,{method:'POST',body:input,idempotencyKey:pending.key});
        pending.acknowledge();
        if(!isCurrent()) return;
        location.assign('/collect?receipt='+encodeURIComponent(result.operation.id));
      } catch(err) {status.textContent=err.message;btn.disabled=false;}
    });
  };
  document.querySelectorAll('[data-mint-stage]').forEach(button=>button.addEventListener('click',()=>{
    const inv=inventories.items.find(inv=>inv.id===button.dataset.mintInventory);
    const stage=inv.stages.find(s=>s.id===button.dataset.mintStage);
    open('Review mint reservation',pairs([['Collection',inv.id],['Stage',stage.id],['Price',sol(stage.priceLamports)],
      ['Creation and network quote',sol(stage.costLamports)],['Wallet limit',stage.walletLimit]])
      +'<p>This reserves one local slot and waits for its committed draw. Your wallet pays no SOL in this preview.</p>');
    submit('Reserve preview slot','/collect/inventories/'+encodeURIComponent(inv.id)+'/stages/'+encodeURIComponent(stage.id)+'/reservations',{});
  }));
  const progress=async(targetId,materialId)=>{
    const serial=open(materialId?'Review Level upgrade':'Review visual reroll','<p>Getting a current quote…</p>');
    try {
      const target=assets.items.find(a=>a.id===targetId);
      const req={kind:materialId?'upgrade':'visual',targetId:target.id,expectedTargetVersion:target.version};
      if(materialId) {
        const material=await api('/collect/assets/'+encodeURIComponent(materialId));
        req.materialId=material.id;req.expectedMaterialVersion=material.version;
      }
      const path='/collect/inventories/'+encodeURIComponent(target.inventoryId)+'/progression';
      const quote=await api(path+'/quote',{method:'POST',body:req});
      if(!isCurrent() || !dialog.open || serial!==reviewGeneration) return;
      const info=[['Target',target.id],['Fee quote',sol(quote.feeLamports)]];
      let extra='';
      if(materialId) {
        info.push(['Target Level',quote.nextTargetLevel],['Target expiry',date(quote.nextTargetExpiry)],['Material NFT',materialId]);
        extra='<details><summary>Material Level probabilities</summary>'+pairs(quote.materialProbabilities.map(row=>
          ['Level '+row.level,row.count+' of '+row.total]))+'</details>';
      } else info.push(['Level',quote.level],['Cooldown after fulfillment',quote.cooldownMs/3_600_000+' hours'],
        ['Traits replaced',quote.fields.join(', ')]);
      body.innerHTML=pairs(info)+extra+'<p>This local preview holds the selected NFT'+(materialId?'s':'')+' until the committed result arrives.</p>';
      submit('Record preview request',path,req);
    } catch(err) {if(serial===reviewGeneration && dialog.open){body.textContent='';status.textContent=err.message}}
  };
  document.querySelectorAll('[data-reroll]').forEach(btn=>btn.addEventListener('click',()=>progress(btn.dataset.reroll)));
  document.querySelectorAll('[data-upgrade]').forEach(form=>form.addEventListener('submit',event=>{
    event.preventDefault();progress(form.dataset.upgrade,new FormData(form).get('material'));
  }));
}

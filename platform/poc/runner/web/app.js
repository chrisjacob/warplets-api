import {getWallets} from '@wallet-standard/app';

const $=id=>document.getElementById(id);
const element=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const button=(text,run,disabled=false)=>{const b=element('button',text);b.disabled=disabled;b.onclick=()=>work(run);return b;};
const json=value=>JSON.stringify(value,null,2);
const tag=(text,cls='')=>element('span',text,'tag '+cls);
const b64=bytes=>btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));
const bytes=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
let data,selected='P00',wallet,account,busy=false,walletOptions=[],unsubscribe;
const drafts=new Map();
const registry=getWallets();
const say=text=>{$('message').textContent=text;};
async function request(path,body) {
  const response=await fetch('/api/'+path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json','x-poc-csrf':data.csrf},body:json(body)});
  const result=await response.json();if(!response.ok)throw Error(result.error??'Request failed');return result;
}
async function refresh(render=true) {data=await request('state');if(render)paint();}
async function work(fn) {if(busy)return;busy=true;paint();say('Working…');try {await fn();}catch(error){say(error.message??String(error));}finally{busy=false;await refresh();}}
function discover() {
  const old=$('wallets').value;
  walletOptions=registry.get().filter(w=>w.chains.includes('solana:mainnet')&&w.features['standard:connect']&&w.features['solana:signTransaction']);
  $('wallets').replaceChildren(...(walletOptions.length?walletOptions.map((w,i)=>{const o=element('option',w.name);o.value=String(i);return o;}):[element('option','No compatible wallet detected')]));
  if(walletOptions[Number(old)])$('wallets').value=old;
}
registry.on('register',discover);registry.on('unregister',discover);discover();
$('connect').onclick=()=>work(async()=>{
  const chosen=walletOptions[Number($('wallets').value)];if(!chosen)throw Error('Install/unlock a Wallet Standard wallet with Solana signTransaction support, then reload.');
  const connected=await chosen.features['standard:connect'].connect();
  const found=connected.accounts.find(a=>a.chains.includes('solana:mainnet')&&a.features.includes('solana:signTransaction'));
  if(!found)throw Error('This wallet account cannot sign mainnet transactions');
  wallet=chosen;account=found;unsubscribe?.();
  unsubscribe=wallet.features['standard:events']?.on('change',()=>{account=null;wallet=null;say('Wallet changed. Reconnect before signing.');paint();});
  say('Wallet connected. Preparing a probe only reads and simulates; signing is a separate button.');
});
$('all-checks').onclick=()=>work(async()=>{await request('checks',{poc:'ALL'});say('Local checks started. Results will appear here; no wallet needed.');});
$('observe').onclick=()=>work(async()=>{await request('observe',{});say('Mainnet genesis and current SOL price observed. No transaction prepared or sent.');});

function paint() {
  if(!data)return;
  const state=data.state,pending=state.attempts.find(a=>['prepared','submitted','unknown','verification-failed'].includes(a.status));
  $('network').textContent=data.mode==='mainnet'?'LOCAL ONLY · SOLANA MAINNET':'MOCK QA · NO REAL TRANSACTIONS';
  $('network').classList.toggle('mock',data.mode!=='mainnet');
  $('account').textContent=account?account.address:(state.wallet?'This run is bound to '+state.wallet+'. Reconnect that account.':'Connect a separate test account. Keep its seed in your wallet.');
  $('connect').disabled=busy;
  $('observe').disabled=busy;
  $('price').textContent=state.observation?'Last observed SOL: $'+state.observation.price.usdPerSol+' · '+state.observation.price.observedAt+' · $10 ≈ '+(10/state.observation.price.usdPerSol).toFixed(6)+' SOL':'';
  $('spend').textContent='$'+state.spentUsd.toFixed(4)+' spent · '+(state.spentLamports/1e9).toFixed(6)+' SOL · $'+(pending?.reservedUsd??0).toFixed(4)+' reserved';
  $('revision').textContent='Source '+(data.source.commit??'uncommitted')+' · Node '+data.source.node;
  $('all-checks').disabled=busy||state.checks.some(j=>j.status==='running');
  $('scenarios').replaceChildren(...data.catalogue.map(p=>{
    const b=element('button',p.id+'  '+p.title);b.onclick=()=>{selected=p.id;say('');paint();};b.setAttribute('aria-current',String(selected===p.id));
    const local=[...state.checks].reverse().find(j=>j.poc===p.id||j.poc==='ALL'),live=state.attempts.filter(a=>a.poc===p.id&&a.status==='finalized').length;
    b.append(element('small','Local: '+(local?.status??'not run')+' · '+live+' finalized probes'));return b;
  }));
  const poc=data.catalogue.find(p=>p.id===selected),main=$('detail');main.replaceChildren(element('h2',poc.id+' · '+poc.title));
  const warning=element('section',undefined,'card blocker');warning.append(tag('Full POC acceptance: open'),element('p',poc.blocker));
  if(state.hold)warning.append(element('p','RUN HOLD: '+state.hold));main.append(warning);
  const steps=element('details');steps.append(element('summary','Test plan and acceptance criteria'));
  for(const [title,items] of [['Steps',poc.steps],['Pass criteria',poc.passCriteria]]){steps.append(element('h3',title));const list=element('ul');for(const item of items)list.append(element('li',item));steps.append(list);}main.append(steps);
  const local=element('section',undefined,'card');local.append(element('h3','Local validation'),element('p','Runs the real repository tests for this POC. Captured-program and model evidence do not establish funded mainnet acceptance.'),button('Run '+poc.id+' local checks',async()=>{await request('checks',{poc:poc.id});say('Local checks started.');},busy||state.checks.some(j=>j.status==='running')));
  const job=[...state.checks].reverse().find(j=>j.poc===poc.id||j.poc==='ALL');
  if(job){local.append(tag(job.status,job.status));const log=element('details');log.open=job.status==='running';log.append(element('summary','Test output and source'),element('pre',job.log||'Starting…'),element('pre',json(job.source)));local.append(log);}main.append(local);
  if(pending){
    const card=element('section',undefined,'card');card.append(element('h3','Pending: '+pending.action),tag(pending.status,pending.status),element('p','Cost reserve (simulation + margin): '+(pending.reservedLamports/1e9).toFixed(6)+' SOL ($'+pending.reservedUsd.toFixed(4)+'). Exact packet stays fixed until expiry.'),element('pre',json(pending.detail)));
    const exact=element('details');exact.append(element('summary','Inspect instructions, simulation and network'),element('pre',json({payer:pending.payer,block:pending.block,price:pending.price,instructions:pending.instructions,simulation:pending.simulation,observation:pending.observation})));card.append(exact);
    if(pending.error)card.append(element('p',pending.error));
    if(pending.status==='prepared')card.append(button('Approve in browser wallet',async()=>{
      if(!account||account.address!==pending.payer)throw Error('Connect the original preparing wallet');
      const signingWallet=wallet,signingAccount=account;
      const [output]=await signingWallet.features['solana:signTransaction'].signTransaction({account:signingAccount,chain:'solana:mainnet',transaction:bytes(pending.packet)});
      if(wallet!==signingWallet||account?.address!==signingAccount.address)throw Error('Wallet changed while signing; no submission sent');
      const result=await request('submit',{id:pending.id,signedTransaction:b64(output.signedTransaction)});
      say('Transaction '+result.status+'. Use Recover to check finality.');
    },busy||!account||account.address!==pending.payer));
    card.append(button('Recover / check expiry',async()=>{const result=await request('recover',{id:pending.id});say('Attempt status: '+result.status);},busy),element('p','A wallet rejection leaves this packet prepared. Retry the same packet or wait for expiry and recover. An ambiguous submitted transaction blocks replacements.'));
    main.append(card);
  }
  main.append(element('h3','Mainnet probes'));
  if(!poc.actions.length)main.append(element('p','This POC has runnable local checks and evidence capture. Its funded mainnet adapter is blocked by the acceptance issues above.'));
  const grid=element('div',undefined,'actions');
  for(const action of poc.actions){
    const card=element('section',undefined,'card');card.append(element('h3',action.title),element('p',action.description));
    let recipient;
    if(action.recipient){const id='recipient-'+action.id,label=element('label','Recipient test-wallet address');label.htmlFor=id;recipient=element('input');recipient.id=id;recipient.autocomplete='off';recipient.spellcheck=false;recipient.value=drafts.get(id)??'';recipient.oninput=()=>drafts.set(id,recipient.value);card.append(label,recipient);}
    const missing=action.requires.filter(r=>!state.artifacts[r]),done=state.artifacts[action.id]&&!action.repeatable;
    if(missing.length)card.append(element('p','Requires: '+missing.join(', ')));
    if(done)card.append(tag('Finalized probe','passed'));
    card.append(button('Prepare '+action.id,async()=>{await request('prepare',{action:action.id,payer:account.address,recipient:recipient?.value.trim()});say('Simulation passed. Review the prepared packet, then approve in your browser wallet.');},busy||!account||!!pending||!!done||!!missing.length||!!state.hold));grid.append(card);
  }main.append(grid);
  const history=state.attempts.filter(a=>a.poc===poc.id);
  if(history.length){main.append(element('h3','Attempt history'));for(const a of history){const item=element('details',undefined,'card');item.append(element('summary',a.action+' · '+a.status+' · '+a.createdAt));if(a.signature){const link=element('a','View transaction on Solana Explorer');link.href='https://explorer.solana.com/tx/'+a.signature;link.target='_blank';link.rel='noreferrer';item.append(link);}item.append(element('pre',json(a)));main.append(item);}}
  const notes=element('section',undefined,'card');notes.append(element('h3','Manual observations'),element('p','Record wallet/device versions, marketplace steps, expected results and evidence links. Notes are marked unverified and never turn a POC green.'));
  const text=element('textarea');text.maxLength=4000;text.setAttribute('aria-label','Observation');text.value=drafts.get('note:'+poc.id)??'';text.oninput=()=>drafts.set('note:'+poc.id,text.value);notes.append(text,button('Save observation',async()=>{await request('notes',{poc:poc.id,text:text.value});drafts.delete('note:'+poc.id);say('Observation saved.');},busy));
  for(const note of state.notes.filter(n=>n.poc===poc.id))notes.append(element('p',note.at+' · '+note.text,'break'));main.append(notes);
}
await refresh();
// Poll only read-only state. Signing, sending and recovery always need clicks.
setInterval(async()=>{if(busy||!data?.state.checks.some(j=>j.status==='running'))return;try{await refresh();}catch{}},2000);

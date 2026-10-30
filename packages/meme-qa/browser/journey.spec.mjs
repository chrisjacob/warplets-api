import { test, expect } from '@playwright/test';
async function installWallet(page,{cancel=false}={}){
  await page.addInitScript(async({cancel})=>{
    const keys=await crypto.subtle.generateKey({name:'Ed25519'},false,['sign','verify']);
    const publicKey=new Uint8Array(await crypto.subtle.exportKey('raw',keys.publicKey));
    const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let n=BigInt('0x'+Array.from(publicKey,b=>b.toString(16).padStart(2,'0')).join('')),address='';while(n){address=alphabet[Number(n%58n)]+address;n/=58n;}for(const b of publicKey){if(b!==0)break;address='1'+address;}
    const account={address,publicKey,chains:['solana:mainnet'],features:['solana:signMessage']};
    const wallet={version:'1.0.0',name:'Disposable QA Wallet',icon:'data:image/svg+xml;base64,PHN2Zy8+',chains:['solana:mainnet'],accounts:[account],features:{'standard:connect':{version:'1.0.0',connect:async()=>({accounts:[account]})},'standard:events':{version:'1.0.0',on:()=>()=>{}},'solana:signMessage':{version:'1.0.0',signMessage:async(input)=>{if(cancel)throw Error('User rejected the request');return [{signedMessage:input.message,signature:new Uint8Array(await crypto.subtle.sign('Ed25519',keys.privateKey,input.message))}];}}}};
    window.addEventListener('wallet-standard:app-ready',event=>event.detail.register(wallet));
    window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet',{detail:api=>api.register(wallet)}));
  },{cancel});
}
test.beforeEach(async({page})=>{
  await page.context().route('**/*',route=>{const u=new URL(route.request().url());return ['127.0.0.1','localhost'].includes(u.hostname)?route.continue():route.abort();});
  const r=await page.request.post('http://127.0.0.1:8798/__qa/reset');expect(r.ok(),await r.text()).toBeTruthy();
});
test('real Solana proof, changed vote, operator selection and history use the actual local Worker',async({page})=>{
  await installWallet(page);await page.goto('/');
  await page.getByRole('button',{name:'Verify wallet',exact:true}).click();
  await expect(page.getByRole('button',{name:'Verify reward wallet',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Verify reward wallet',exact:true}).click();
  await expect(page.getByText(/Verified ·/)).toBeVisible();
  await page.keyboard.press('Escape');
  const alpha=page.locator('article.candidate').filter({has:page.getByRole('heading',{name:'Alpha',exact:true})});
  const beta=page.locator('article.candidate').filter({has:page.getByRole('heading',{name:'Beta',exact:true})});
  await alpha.getByRole('button',{name:'Vote',exact:true}).click();await expect(alpha.getByRole('button',{name:'✓ Voted'})).toBeVisible();
  const first=await(await page.request.get('/api/meme/state')).json();
  await beta.getByRole('button',{name:'Vote',exact:true}).click();await expect(beta.getByRole('button',{name:'✓ Voted'})).toBeVisible();
  const second=await(await page.request.get('/api/meme/state')).json();expect(second.myVote.first_valid_at).toBe(first.myVote.first_valid_at);expect(second.myVote.reward_wallet).toBe(first.myVote.reward_wallet);
  const selected=await page.request.post('http://127.0.0.1:8798/__qa/select');expect(selected.ok(),await selected.text()).toBeTruthy();await page.reload();
  await expect(page.getByRole('heading',{name:'Selected: Beta'})).toBeVisible();
  await page.getByRole('tab',{name:'History',exact:true}).click();await expect(page.getByText('Selected: Beta',{exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'Rewards',exact:true}).click();await expect(page.getByRole('button',{name:'Claims coming later'})).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
test('wallet cancellation stays recoverable and skip is clear',async({page})=>{
  await installWallet(page,{cancel:true});await page.goto('/');await page.getByRole('button',{name:'Verify wallet',exact:true}).click();await page.getByRole('button',{name:'Verify reward wallet',exact:true}).click();await expect(page.getByText('User rejected the request',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Verify reward wallet',exact:true})).toBeEnabled();await page.keyboard.press('Escape');
  const skipped=await page.request.post('http://127.0.0.1:8798/__qa/skip');expect(skipped.ok(),await skipped.text()).toBeTruthy();await page.reload();await expect(page.getByRole('heading',{name:'No launch today'})).toBeVisible();
});
test('test harness and financial actions do not enter the production Worker routes',async({page})=>{
  for(const path of ['/api/meme/transactions/sign','/api/meme/claims']){const r=await page.request.get(path);expect([401,403,404,423]).toContain(r.status());}
  const r=await page.request.post('/api/meme/operator/transactions',{headers:{origin:'http://127.0.0.1:5196'},data:{plan:{}}});expect(r.status()).toBe(401);
});

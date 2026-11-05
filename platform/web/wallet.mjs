const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Browser-safe encoder for the expected 64-byte Ed25519 signature. */
export function encodeSignature(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 64) throw new Error('The wallet returned an invalid signature.');
  let zeros=0;
  while (zeros < bytes.length && bytes[zeros]===0) zeros++;
  let n=0n;
  for (const b of bytes) n=n*256n+BigInt(b);
  let value='';
  while (n>0n) { value=BASE58[Number(n%58n)]+value; n/=58n; }
  return '1'.repeat(zeros)+value;
}

export function findSigningWallet(browser) {
  return [browser.phantom?.solana, browser.solana].find(provider=>
    typeof provider?.connect==='function' && typeof provider?.signMessage==='function') ?? null;
}

export function validateChallenge(challenge, wallet, origin, now=Date.now()) {
  const lines=challenge?.message?.split('\n');
  if (!lines || lines.length!==7 || lines[0]!==origin+' requests a 10X.MEME wallet signature.'
    || lines[1]!=='Action: Sign in to the local preview' || lines[2]!=='Chain: solana'
    || lines[3]!=='Wallet: '+wallet || !/^[A-Za-z0-9_-]{43}$/.test(challenge.nonce)
    || lines[4]!=='Nonce: '+challenge.nonce || !lines[5].startsWith('Issued: ')
    || lines[6]!=='Expires: '+challenge.expiresAt || !(Date.parse(challenge.expiresAt)>now)) {
    throw new Error('The sign-in request is invalid or expired. Start again.');
  }
}

const shortened = s => s.slice(0,5)+'…'+s.slice(-5);

export function initWallet({ api, onSession }) {
  const dialog=document.querySelector('#wallet-dialog'), panel=document.querySelector('#wallet-panel'),
    status=document.querySelector('#wallet-status'), label=document.querySelector('#wallet-name');
  let me=null, attempt=0;
  const button=(name,run)=>{
    const el=document.createElement('button'); el.type='button'; el.textContent=name;
    el.addEventListener('click',async()=>{
      el.disabled=true;status.textContent='';
      try { await run(); } catch (err) { if(dialog.open) status.textContent=err?.message || 'Unable to continue.'; }
      finally { el.disabled=false; }
    });
    panel.append(el);
  };
  const paragraph=text=>{const p=document.createElement('p');p.textContent=text;panel.append(p)};
  const session=value=>{me=value;label.textContent=me?shortened(me.wallet):'Connect wallet';onSession(me)};
  const show=()=>{
    attempt++; panel.replaceChildren();status.textContent='';
    document.querySelector('#wallet-title').textContent=me?'Wallet account':'Connect a wallet';
    if(me) {
      paragraph('Verified Solana wallet: '+me.wallet);
      button('Sign out',async()=>{ await api('/auth/logout',{method:'POST'});session(null);dialog.close(); });
      return;
    }
    const provider=findSigningWallet(window);
    if(!provider) {
      paragraph('A Solana wallet that supports message signing is required to sign in. Open this preview in a browser with a compatible wallet.');
      return;
    }
    paragraph('Connect your Solana wallet, then review the sign-in message before signing.');
    button('Connect Solana wallet',async()=>{
      const current=attempt;
      const connection=await provider.connect();
      if(current!==attempt || !dialog.open) return;
      const wallet=String(connection?.publicKey ?? '');
      if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) throw new Error('No Solana account was selected.');
      const challenge=await api('/auth/challenges',{method:'POST',body:{wallet}});
      validateChallenge(challenge,wallet,location.origin);
      if(current!==attempt || !dialog.open) return;
      panel.replaceChildren();paragraph('Review this message. Signing opens a local session for this address.');
      const pre=document.createElement('pre');pre.textContent=challenge.message;panel.append(pre);
      button('Sign in with this message',async()=>{
        validateChallenge(challenge,wallet,location.origin);
        if(String(provider.publicKey)!==wallet) throw new Error('The selected wallet changed. Reopen the panel.');
        const signed=await provider.signMessage(new TextEncoder().encode(challenge.message),'utf8');
        if(current!==attempt || !dialog.open) return;
        const signature=encodeSignature(signed.signature);
        const profile=await api('/auth/verify',{method:'POST',body:{nonce:challenge.nonce,signature}});
        session(profile);if(dialog.open) dialog.close();
      });
    });
  };
  document.querySelector('#wallet-button').addEventListener('click',()=>{show();dialog.showModal()});
  document.querySelector('#close-wallet').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{attempt++;panel.replaceChildren();status.textContent=''});
  return { session };
}

import {RefreshProposal} from './refresh';
import {clearRefreshReview} from './refresh-review.mjs';
import { Capability, useRuntimeQuery } from './capabilities';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Challenge } from '../../contracts/client.mjs';
import { client, sdk } from './sdk';
import { compact, friendlyError, Modal, Signal } from './common';
import { checkChallenge, discoverWallets, onWalletsChanged, signature58, type Adapter, type Connection } from './wallet-adapters';
import { Recovery } from './recovery';
import { Notifications } from './notifications';

const SessionContext=createContext<{wallet:string|null;open:()=>void}>({wallet:null,open:()=>{}});
export const useSession=()=>useContext(SessionContext);
type Review={challenge:Challenge;connection:Connection};

export function SessionProvider({children}:{children:ReactNode}){
  const cache=useQueryClient();
  const profile=useRuntimeQuery('/api/v1/me',{queryKey:['profile'],queryFn:({signal})=>sdk.profile(signal),staleTime:30_000,refetchOnWindowFocus:true});
  const wallet=profile.availability.allowed && !profile.isError?profile.data?.wallet??null:null;
  const previousWallet=useRef<string|null>(null);
  useEffect(()=>{
    if(previousWallet.current && previousWallet.current!==wallet){
      void cache.cancelQueries({queryKey:['private',previousWallet.current]});
      cache.removeQueries({queryKey:['private',previousWallet.current]});
    }
    previousWallet.current=wallet;
  },[cache,wallet]);
  const [visible,setVisible]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [review,setReview]=useState<Review|null>(null),[adapters,setAdapters]=useState<Adapter[]>([]);
  const [accounts,setAccounts]=useState<Connection[]>([]),[activeAdapter,setActiveAdapter]=useState<Adapter|null>(null);
  const attempt=useRef(0),unwatch=useRef<(()=>void)|undefined>(undefined);
  const [selectedAccount,setSelectedAccount]=useState<string|null>(null),[accountChanged,setAccountChanged]=useState(false);
  useEffect(()=>()=>unwatch.current?.(),[]);
  useEffect(()=>{
    const refresh=()=>{void cache.invalidateQueries({queryKey:['profile']});void cache.invalidateQueries({queryKey:['private']});};
    const expired=()=>{attempt.current++;setReview(null);setBusy(false);void cache.cancelQueries({queryKey:['private']});
      cache.removeQueries({queryKey:['private']});void cache.cancelQueries({queryKey:['profile']});cache.setQueryData(['profile'],null);};
    window.addEventListener('focus',refresh);window.addEventListener('pageshow',refresh);
    window.addEventListener('10x:session-expired',expired);
    return ()=>{window.removeEventListener('focus',refresh);window.removeEventListener('pageshow',refresh);window.removeEventListener('10x:session-expired',expired);};
  },[cache]);
  useEffect(()=>{
    if(!visible)return;
    const refresh=()=>setAdapters(discoverWallets());
    refresh();return onWalletsChanged(refresh);
  },[visible]);
  const close=()=>{attempt.current++;setVisible(false);setAccounts([]);setReview(null);setBusy(false);setError('');};
  const open=()=>{setError('');setVisible(true);};
  function resetSelection(){
    attempt.current++;unwatch.current?.();unwatch.current=undefined;setReview(null);setAccounts([]);setBusy(false);setError('');
  }
  async function connect(adapter:Adapter,reconnect=false){
    resetSelection();const generation=++attempt.current;setBusy(true);setActiveAdapter(adapter);
    try {
      if(reconnect && adapter.disconnect)await adapter.disconnect();
      if(generation!==attempt.current)return;
      const available=await adapter.connect();
      if(generation===attempt.current)setAccounts(available);
    }catch(e){if(generation===attempt.current)setError(friendlyError(e));}
    finally{if(generation===attempt.current)setBusy(false);}
  }
  async function chooseAccount(connection:Connection){
    const generation=++attempt.current;setBusy(true);setError('');
    try {
      unwatch.current?.();setSelectedAccount(connection.address);setAccountChanged(false);
      unwatch.current=connection.watch(address=>{
        if(address===connection.address)return;
        attempt.current++;setReview(null);setAccounts([]);setBusy(false);setSelectedAccount(address);setAccountChanged(true);
        setError('The selected wallet account changed or disconnected. Reconnect to review a new sign-in message.');
      });
      const {data:challenge}=await client.createWalletChallenge({body:{wallet:connection.address}});
      checkChallenge(challenge,connection.address,location.origin);
      if(generation===attempt.current)setReview({challenge,connection});
    }catch(e){if(generation===attempt.current)setError(friendlyError(e));}
    finally{if(generation===attempt.current)setBusy(false);}
  }
  async function verify(){
    if(!review)return;
    const generation=attempt.current;setBusy(true);setError('');
    try {
      checkChallenge(review.challenge,review.connection.address,location.origin);
      const bytes=await review.connection.sign(new TextEncoder().encode(review.challenge.message));
      if(generation!==attempt.current)return;
      const {data}=await client.verifyWalletSignature({body:{nonce:review.challenge.nonce,signature:signature58(bytes)}});
      if(generation!==attempt.current){await client.revokeSession();await cache.invalidateQueries({queryKey:['profile']});return;}
      await cache.cancelQueries({queryKey:['profile']});
      cache.setQueryData(['profile'],{wallet:data.wallet,chain:'solana'});
      close();
    }catch(e){if(generation===attempt.current)setError(friendlyError(e));}
    finally{if(generation===attempt.current)setBusy(false);}
  }
  async function logout(switchAccount=false){
    attempt.current++;setReview(null);setAccounts([]);
    setBusy(true);setError('');
    try{
      await client.revokeSession();
      clearRefreshReview();
      if(wallet){await cache.cancelQueries({queryKey:['private',wallet]});cache.removeQueries({queryKey:['private',wallet]});}
      unwatch.current?.();unwatch.current=undefined;setSelectedAccount(null);setAccountChanged(false);
      await cache.cancelQueries({queryKey:['profile']});
      cache.setQueryData(['profile'],null);
      if(switchAccount){setBusy(false);setVisible(true);}else close();
    }catch(e){setError(friendlyError(e));setBusy(false);}
  }
  return <SessionContext.Provider value={{wallet,open}}>
    {children}
    {visible && <Modal title={wallet?'Wallet account':'Connect a wallet'} id="wallet-dialog" onClose={close}>
      {wallet?<><p className="wrap-anywhere">Verified Solana wallet: {wallet}</p><button onClick={()=>void logout()} disabled={busy}>Sign out</button><button onClick={()=>void logout(true)} disabled={busy}>Switch account</button>
        {accountChanged&&<Signal>The browser wallet {selectedAccount?'now selects '+compact(selectedAccount):'is disconnected'}. This session remains authenticated as {compact(wallet)} until you sign out.</Signal>}
        <Capability path="/api/v1/notifications/capabilities"><Notifications key={'notices:'+wallet} wallet={wallet}/></Capability>
        <Capability path="/api/v1/nfts/refreshes/{id}"><RefreshProposal key={'refresh:'+wallet} wallet={wallet}/></Capability>
        <Capability path="/api/v1/transactions/{id}"><Recovery key={wallet} wallet={wallet}/></Capability></>
        :review?<><p>Review this sign-in message for <span className="wrap-anywhere">{review.connection.address}</span>. This signs a message only; it does not send a transaction.</p><pre>{review.challenge.message}</pre>
        <Capability method="POST" path="/api/v1/auth/verify"><button onClick={verify} disabled={busy}>Sign in with this message</button></Capability><button onClick={()=>{setReview(null);setError('');attempt.current++;}} disabled={busy}>Choose another account</button></>
        :accounts.length?<><p>Choose the Solana account to sign in with.</p>{accounts.map(account=><button className="wrap-anywhere" key={account.address} disabled={busy} onClick={()=>void chooseAccount(account)}>Use account {account.address}</button>)}<p>Missing an account? Select it in the Trust Wallet extension, then refresh accounts. The app can only list accounts the extension shares.</p><button disabled={busy} onClick={()=>activeAdapter&&void connect(activeAdapter)}>Refresh accounts</button>{activeAdapter?.disconnect&&<button disabled={busy} onClick={()=>void connect(activeAdapter,true)}>Reconnect wallet permissions</button>}<button disabled={busy} onClick={resetSelection}>Choose another wallet</button></>
        :adapters.length?<Capability method="POST" path="/api/v1/auth/challenges"><><p>Select your desired account in the wallet extension, then connect. You will choose an account before reviewing a sign-in message.</p>
          {adapters.map((a,i)=><button key={i} onClick={()=>void connect(a)} disabled={busy}>Connect {a.name}</button>)}</></Capability>
        :<p>Open the preview in a browser with a Solana wallet that supports message signing.</p>}
      {error && <Signal>{error}</Signal>}
    </Modal>}
  </SessionContext.Provider>;
}

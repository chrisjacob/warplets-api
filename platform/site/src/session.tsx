import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Challenge } from '../../contracts/client.mjs';
import { client, sdk } from './sdk';
import { compact, friendlyError, Modal, Signal } from './common';
import { checkChallenge, discoverWallets, onWalletsChanged, signature58, type Adapter } from './wallet-adapters';
import { Recovery } from './recovery';

const SessionContext=createContext<{wallet:string|null;open:()=>void}>({wallet:null,open:()=>{}});
export const useSession=()=>useContext(SessionContext);
type Review={challenge:Challenge;connection:Awaited<ReturnType<Adapter['connect']>>};

export function SessionProvider({children}:{children:ReactNode}){
  const cache=useQueryClient();
  const profile=useQuery({queryKey:['profile'],queryFn:({signal})=>sdk.profile(signal),staleTime:30_000});
  const wallet=profile.data?.wallet??null;
  const previousWallet=useRef<string|null>(null);
  useEffect(()=>{
    if(previousWallet.current && previousWallet.current!==wallet)cache.removeQueries({queryKey:['private',previousWallet.current]});
    previousWallet.current=wallet;
  },[cache,wallet]);
  const [visible,setVisible]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [review,setReview]=useState<Review|null>(null),[adapters,setAdapters]=useState<Adapter[]>([]);
  const attempt=useRef(0);
  useEffect(()=>{
    if(!visible)return;
    const refresh=()=>setAdapters(discoverWallets());
    refresh();return onWalletsChanged(refresh);
  },[visible]);
  const close=()=>{attempt.current++;setVisible(false);setReview(null);setBusy(false);setError('');};
  const open=()=>{setError('');setVisible(true);};
  async function connect(adapter:Adapter){
    const generation=attempt.current;setBusy(true);setError('');
    try {
      const connection=await adapter.connect();
      if(generation!==attempt.current)return;
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
      cache.setQueryData(['profile'],{wallet:data.wallet,chain:'solana'});
      close();
    }catch(e){if(generation===attempt.current)setError(friendlyError(e));}
    finally{if(generation===attempt.current)setBusy(false);}
  }
  async function logout(){
    setBusy(true);setError('');
    try{
      await client.revokeSession();
      if(wallet)cache.removeQueries({queryKey:['private',wallet]});
      cache.setQueryData(['profile'],null);close();
    }catch(e){setError(friendlyError(e));setBusy(false);}
  }
  return <SessionContext.Provider value={{wallet,open}}>
    {children}
    {visible && <Modal title={wallet?'Wallet account':'Connect a wallet'} id="wallet-dialog" onClose={close}>
      {wallet?<><p className="wrap-anywhere">Verified Solana wallet: {wallet}</p><button onClick={logout} disabled={busy}>Sign out</button><Recovery key={wallet} wallet={wallet}/></>
        :review?<><p>Review this sign-in message for {compact(review.connection.address)}.</p><pre>{review.challenge.message}</pre>
        <button onClick={verify} disabled={busy}>Sign in with this message</button></>
        :adapters.length?<><p>Choose a wallet to review its sign-in message.</p>
          {adapters.map((a,i)=><button key={i} onClick={()=>void connect(a)} disabled={busy}>Connect {a.name}</button>)}</>
        :<p>Open the preview in a browser with a Solana wallet that supports message signing.</p>}
      {error && <Signal>{error}</Signal>}
    </Modal>}
  </SessionContext.Provider>;
}

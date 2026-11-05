import type { ReactNode } from 'react';
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { runtimeTransport } from './sdk';
import { supportsRoute } from './capability-transport.mjs';

export function useCapabilities(){
  return useQuery({queryKey:['runtime-capabilities','/api/v1',1],queryFn:()=>runtimeTransport.discover(),
    staleTime:30_000,retry:false,refetchOnWindowFocus:true});
}
export function useCapability(method:string,path:string){
  const discovery=useCapabilities();
  return {allowed:!discovery.isError && supportsRoute(discovery.data,method,path),
    pending:discovery.isPending,
    reason:discovery.isError?'Runtime capabilities are unavailable. Retry shortly to refresh support.':
      'This feature is unavailable in the connected runtime.',
    refresh:()=>{runtimeTransport.clear();void discovery.refetch();}};
}
export function Capability({method='GET',path,children}:{method?:string;path:string;children:ReactNode}){
  const capability=useCapability(method,path);
  if(capability.allowed)return <>{children}</>;
  return <div role="status"><p>{capability.pending?'Checking runtime support...':capability.reason}</p>
    {!capability.pending&&<button onClick={capability.refresh}>Refresh runtime support</button>}</div>;
}
/** A disabled dependent observer never invokes its query function. Loaded also
 * receives the support state, so unavailable data cannot look like an empty page. */
export function useRuntimeQuery<T>(path:string,options:UseQueryOptions<T>){
  const capability=useCapability('GET',path);
  const query=useQuery({...options,enabled:capability.allowed && options.enabled!==false});
  return {...query,availability:capability};
}
export const privateKey=(wallet:string|null,...parts:unknown[])=>['private',wallet,'solana',...parts];
export const principalKey=(wallet:string|null,...parts:unknown[])=>wallet?privateKey(wallet,...parts):['public','solana',...parts];

/** Browser-only host hooks; no server state or app internals enter this package. */
type Host={name?:()=>string;icon?:()=>string;track?:(event:string,context?:Record<string,unknown>)=>void;success?:()=>Promise<void>};
let host:Host={};
export function configureConnectHost(next:Host){host=next}
export const getRuntimeAppName=()=>host.name?.()??'10X.meme';
export const getRuntimeAppIconPath=()=>host.icon?.()??'/icon.png';
export const trackAppEvent=(event:string,context?:Record<string,unknown>)=>host.track?.(event,context);
export const hapticSuccess=async()=>{await host.success?.()};
export function isLikelyBaseAppBrowser(){if(typeof navigator==='undefined'||typeof window==='undefined')return false;const ua=navigator.userAgent.toLowerCase();const provider=(window as Window&{ethereum?:{isCoinbaseWallet?:boolean}}).ethereum;return /coinbasewallet|baseapp/.test(ua)||document.referrer.toLowerCase().startsWith('https://base.app/')||(/iphone|ipad|ipod|android/.test(ua)&&provider?.isCoinbaseWallet===true)}

import {Connection, PublicKey} from '@solana/web3.js';
import {readFileSync} from 'node:fs';
import {readAccounts} from '../../lab/refresh-kamino.mjs';
import {inspectUpgradeableDeployment} from '../../lab/kamino.mjs';

export const RPC='https://api.mainnet-beta.solana.com';
export const GENESIS='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export const connection=new Connection(RPC,{commitment:'finalized',disableRetryOnRateLimit:true,
  fetch:(url,options)=>fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(25000)})});

export async function rawRpc(method,params) {
  if(!['simulateTransaction','getTransaction'].includes(method))throw Error('Unsupported RPC method');
  const response=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},redirect:'error',signal:AbortSignal.timeout(25000),body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  if(!response.ok)throw Error('Public RPC HTTP '+response.status);
  const data=await response.json();if(data.error)throw Error('RPC '+method+': '+JSON.stringify(data.error));
  return data.result;
}

export async function observePrograms(action) {
  if(await connection.getGenesisHash()!==GENESIS)throw Error('Wrong chain genesis');
  const paths=action.startsWith('nft')?['core-program.json']:['pool','buy','sell','fees'].includes(action)?['meteora-deployment-observation.json']:['distribution','claim'].includes(action)?['rewards-program.json']:[];
  const observations=[];
  for(const name of paths) {
    const value=JSON.parse(readFileSync(new URL('../../lab/fixtures/'+name,import.meta.url))),baseline=value.deployment??value;
    const raw=await readAccounts([baseline.program,baseline.programData],0);
    const observed=inspectUpgradeableDeployment(raw,baseline.program,baseline.programData);
    for(const field of ['allocatedElfSha256','deployedSlot','upgradeAuthority','programDataLength'])if(observed[field]!==baseline[field])throw Error('Program changed: '+name+' '+field+'; review required.');
    observations.push({name,...observed,sourceMatchVerified:false});
  }
  return {genesis:GENESIS,observedAt:new Date().toISOString(),programs:observations};
}

export async function quoteSolUsd() {
  const url='https://api.coinbase.com/v2/prices/SOL-USD/spot';
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('SOL/USD quote unavailable; no transaction can be prepared.');
  const body=await response.json(),price=Number(body.data?.amount);
  if(body.data?.base!=='SOL'||body.data?.currency!=='USD'||!Number.isFinite(price)||price<=0||price>100000)throw Error('Invalid SOL/USD quote');
  return {usdPerSol:price,observedAt:new Date().toISOString(),source:url};
}

export async function chainClock() {
  const slot=await connection.getSlot('confirmed'),time=await connection.getBlockTime(slot);
  if(!Number.isSafeInteger(time)||Math.abs(Date.now()/1000-time)>90)throw Error('Chain clock missing or stale');
  return time;
}

export const liveChain={connection,observePrograms,quoteSolUsd,chainClock,
  simulate:async(tx,payer,minContextSlot)=>(await rawRpc('simulateTransaction',[tx,{encoding:'base64',commitment:'confirmed',sigVerify:false,replaceRecentBlockhash:false,minContextSlot,accounts:{encoding:'base64',addresses:[payer]}}])),
  receipt:signature=>rawRpc('getTransaction',[signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:0}]),
  balance:payer=>connection.getAccountInfoAndContext(new PublicKey(payer),'confirmed'),
};

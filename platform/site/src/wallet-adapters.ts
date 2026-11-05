import { getWallets } from '@wallet-standard/app';
import type { Challenge } from '../../contracts/client.mjs';

type StandardWallet=ReturnType<ReturnType<typeof getWallets>['get']>[number];
type Account=StandardWallet['accounts'][number];
type Connection={address:string;sign:(message:Uint8Array)=>Promise<Uint8Array>;watch:(changed:(address:string|null)=>void)=>()=>void};
export type Adapter={name:string;connect:()=>Promise<Connection>};
type Injected={
  connect():Promise<{publicKey:{toString():string}}>;
  publicKey?:{toString():string};
  on?:(event:string,handler:(account?:{toString():string}|null)=>void)=>void;
  removeListener?:(event:string,handler:(account?:{toString():string}|null)=>void)=>void;
  signMessage(bytes:Uint8Array,enc:'utf8'):Promise<{signature:Uint8Array}>;
};
function standardAdapter(wallet:StandardWallet):Adapter|null{
  const connect=wallet.features['standard:connect'] as {connect?:()=>Promise<{accounts:readonly Account[]}>}|undefined;
  const sign=wallet.features['solana:signMessage'] as {signMessage?:(input:{account:Account;message:Uint8Array})=>Promise<Array<{signedMessage:Uint8Array;signature:Uint8Array}>>}|undefined;
  if(!connect?.connect || !sign?.signMessage || !wallet.chains.some(chain=>chain.startsWith('solana:')))return null;
  return {name:wallet.name,async connect(){
    const {accounts}=await connect.connect!();
    const account=accounts.find(a=>a.features.includes('solana:signMessage')&&a.chains.some(c=>c.startsWith('solana:')));
    if(!account)throw Error('Choose a Solana account that supports sign-in messages.');
    return {address:account.address,watch(changed){
      const events=wallet.features['standard:events'] as {on?:(event:'change',listener:(props:{accounts?:readonly Account[]})=>void)=>()=>void}|undefined;
      const off=events?.on?.('change',props=>{
        if(props.accounts)changed(props.accounts[0]?.address??null);
      });
      const unregister=getWallets().on('unregister',(...removed)=>{if(removed.includes(wallet))changed(null);});
      return ()=>{off?.();unregister();};
    },async sign(message){
      if(!wallet.accounts.some(a=>a.address===account.address))throw Error('The wallet account changed. Reconnect.');
      const [result]=await sign.signMessage!({account,message});
      if(!result || result.signedMessage.length!==message.length || !result.signedMessage.every((b,i)=>b===message[i]))
        throw Error('The wallet changed the sign-in message.');
      return result.signature;
    }};
  }};
}
export function discoverWallets():Adapter[]{
  const standard=getWallets().get().map(standardAdapter).filter((x):x is Adapter=>x!==null);
  const host=window as unknown as {phantom?:{solana?:Injected};solana?:Injected};
  const injected=host.phantom?.solana??host.solana;
  if(injected && typeof injected.connect==='function' && typeof injected.signMessage==='function'
    && (!standard.length || !host.phantom?.solana || !standard.some(a=>a.name.toLowerCase().includes('phantom')))){
    standard.push({name:'Solana wallet',async connect(){
      const connected=await injected.connect();
      const address=connected.publicKey.toString();
      return {address,watch(changed){
        const account=(value?:{toString():string}|null)=>changed(value?.toString()??null);
        const disconnect=()=>changed(null);
        injected.on?.('accountChanged',account);injected.on?.('disconnect',disconnect);
        return ()=>{injected.removeListener?.('accountChanged',account);injected.removeListener?.('disconnect',disconnect);};
      },async sign(bytes){
        if(injected.publicKey?.toString()!==address)throw Error('The wallet account changed. Reconnect.');
        return (await injected.signMessage(bytes,'utf8')).signature;
      }};
    }});
  }
  return standard;
}
export function onWalletsChanged(update:()=>void){
  const wallets=getWallets();
  const off=[wallets.on('register',update),wallets.on('unregister',update)];
  return ()=>off.forEach(unsubscribe=>unsubscribe());
}
export function checkChallenge(challenge:Challenge,address:string,origin:string,now=Date.now()){
  const lines=challenge.message.split('\n');
  if(lines.length!==7 || lines[0]!==origin+' requests a 10X.MEME wallet signature.'
    || lines[1]!=='Action: Sign in to the local preview'||lines[2]!=='Chain: solana'||lines[3]!=='Wallet: '+address
    || !/^[\w-]{43}$/.test(challenge.nonce)||lines[4]!=='Nonce: '+challenge.nonce||!lines[5].startsWith('Issued: ')
    || lines[6]!=='Expires: '+challenge.expiresAt || !(Date.parse(challenge.expiresAt)>now)){
    throw Error('This sign-in message is invalid or expired. Reconnect your wallet.');
  }
}
export function signature58(bytes:Uint8Array){
  if(!(bytes instanceof Uint8Array)||bytes.length!==64)throw Error('The wallet returned an invalid signature.');
  const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let leading=0,n=0n,result='';
  while(leading<bytes.length && bytes[leading]===0)leading++;
  for(const b of bytes)n=n*256n+BigInt(b);
  while(n){result=alphabet[Number(n%58n)]+result;n/=58n;}
  return '1'.repeat(leading)+result;
}

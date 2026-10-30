import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createPublicClient,createWalletClient,http,verifyMessage} from 'viem';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {rpc,loopback} from '../src/safety.mjs';
test('Anvil Base chain verifies a fresh signer, real transaction finality and snapshot recovery',{timeout:30000},async()=>{
  const port=18545,url='http://127.0.0.1:'+port;loopback(url);
  const child=spawn(process.execPath,['node_modules/@foundry-rs/anvil/bin.mjs','--host','127.0.0.1','--port',String(port),'--chain-id','8453','--silent'],{cwd:new URL('..',import.meta.url),stdio:'ignore',windowsHide:true});
  try{
    let ready=false;for(let i=0;i<100;i++){try{await rpc(url,'eth_chainId');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert(ready,'Anvil failed to start');
    const account=privateKeyToAccount(generatePrivateKey()),to=privateKeyToAccount(generatePrivateKey()).address;
    await rpc(url,'anvil_setBalance',[account.address,'0xde0b6b3a7640000']);
    const client=createPublicClient({transport:http(url)}),wallet=createWalletClient({account,transport:http(url)});
    assert.equal(await client.getChainId(),8453);
    const message='Disposable local regression only '+crypto.randomUUID(),signature=await wallet.signMessage({message});assert(await verifyMessage({address:account.address,message,signature}));
    assert.equal(await verifyMessage({address:to,message,signature}),false);
    const snapshot=await rpc(url,'evm_snapshot');
    const tx=await wallet.sendTransaction({chain:{id:8453,name:'Base local',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[url]}}},to,value:1n});
    const receipt=await client.waitForTransactionReceipt({hash:tx});assert.equal(receipt.status,'success');assert.equal(await client.getBalance({address:to}),1n);
    assert.equal(await rpc(url,'evm_revert',[snapshot]),true);assert.equal(await client.getBalance({address:to}),0n);
  }finally{child.kill();}
});

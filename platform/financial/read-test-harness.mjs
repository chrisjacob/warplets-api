// Disposable synthetic acceptance control. Never imported by production routes.
import {createFinancialVaultRepository} from '../storage/financial-vault.mjs';
import {createFinancialFarmRepository} from '../storage/financial-farms.mjs';
import {createFinancialReadService} from './service.mjs';
import {handleFinancialReads} from './http.mjs';
export async function financialReadTestDispatch({driver,crypto,input}){
 let statements=0,batches=0,hashes=0,injected=0;
 const measured={...driver,async batch(values){statements+=values.length;batches++;return driver.batch(values);}};
 const hashCrypto={...crypto,async sha256(bytes){
  hashes++;if(input.fault==='source-always'||input.fault==='source-once'&&injected===0){
   await measured.batch([{sql:'UPDATE vault_assets SET owner=? WHERE id=?',values:[input.faultWallet,'nft-025']}]);injected++;
  }
  return crypto.sha256(bytes);
 }};
 const service=createFinancialReadService({vaultRepository:createFinancialVaultRepository(measured),farmRepository:createFinancialFarmRepository(measured),crypto:hashCrypto,clock:{nowMs:()=>input.nowMs}});
 const request=new Request('http://localhost'+input.path,{method:input.method??'GET'});
 const response=await handleFinancialReads(request,{service,authenticate:async()=>input.wallet?{kind:'wallet',wallet:input.wallet}:null});
 if(!response)throw Error('Unknown financial acceptance route.');
 return {status:response.status,headers:Object.fromEntries(response.headers),body:await response.json(),measurement:{statements,batches,hashes,injected}};
}

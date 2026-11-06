import {generateKeyPairSync} from 'node:crypto';
import {mintFixture} from '../../collect/mint-test-fixture.mjs';
import {createApp} from '../../server/application.mjs';
import {createLocalServer} from '../../server/start.mjs';
import {encode58} from '../../server/base58.mjs';
/** Synthetic normalized stage source with genuine wallet authentication and
 * production Node HTTP composition. The clock is private to this local fixture. */
export async function createMintReviewFixture(){
 const cleanup=[],f=await mintFixture({after:fn=>cleanup.push(fn)},{type:'public',admissionAtMs:Math.floor(Date.now()/1000)*1000-10000});
 const accounts=Object.fromEntries(['original','other'].map(label=>{const pair=generateKeyPairSync('ed25519'),bytes=pair.publicKey.export({type:'spki',format:'der'}).subarray(-32);return [label,{...pair,wallet:encode58(bytes),publicKeyBytes:[...bytes]}];}));
 let offset=0;const now=()=>Date.now()+offset;
 const server=createLocalServer(createApp(f.db,{clock:now}));let closed=false;
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});}
 catch(error){for(const fn of cleanup.reverse())await fn();throw error;}
 return {...f,accounts,now,origin:'http://127.0.0.1:'+server.address().port,advanceTo(value){if(!Number.isSafeInteger(value)||value<now())throw Error('Synthetic clock must advance.');offset=value-Date.now();f.setNow(value);},
  async close(){if(closed)return;closed=true;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));for(const fn of cleanup.reverse())await fn();}};
}

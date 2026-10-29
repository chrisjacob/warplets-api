import{afterEach,describe,expect,it,vi}from'vitest';
import{DatabaseSync}from'node:sqlite';
import{readFileSync}from'node:fs';
import{sqliteD1}from'../sqliteTestDb';
import{alchemyRead,alchemyWalletBalances,alchemyTokenMetadata}from'./alchemy';
import{importWalletBatch,importWalletValue,NATIVE_ASSET,type WalletEnv}from'./wallets';
const instances:DatabaseSync[]=[];
const wallet='0x'+'1'.repeat(40),token='0x'+'2'.repeat(40),spam='0x'+'3'.repeat(40);
function fixture(){const db=new DatabaseSync(':memory:');instances.push(db);for(const file of ['0095_network.sql','0096_network_members.sql','0097_network_wallets.sql','0098_network_activity.sql','0099_network_alchemy.sql','0100_network_geography.sql','0101_network_geography_matching.sql','0102_network_warplet_holders.sql','0103_network_warplet_images.sql'])db.exec(readFileSync(new URL(`../../../../migrations/${file}`,import.meta.url),'utf8'));db.exec("INSERT INTO network_profiles(fid,location_status,token_status,opt_in_status,observed_at) VALUES(1,'unknown','none','opted_in',1),(2,'unknown','none','opted_in',1)");return{db,env:{WARPLETS:sqliteD1(db),ALCHEMY_API_KEY:'test-key-secret-12345',NETWORK_ALCHEMY_CU:'10000'}as WalletEnv};}
const rpc=(result:unknown)=>Response.json({jsonrpc:'2.0',id:1,result});
afterEach(()=>{vi.unstubAllGlobals();for(const db of instances.splice(0))db.close();});
describe('Alchemy free-tier guardrails',()=>{
 it('stops before a provider call at the monthly or daily cap',async()=>{
  const{db,env}=fixture();const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);env.NETWORK_ALCHEMY_CU='1';
  await expect(alchemyRead(env,'eth_getBalance',[wallet,'latest'])).rejects.toThrow('budget exhausted');expect(fetcher).not.toHaveBeenCalled();
  env.NETWORK_ALCHEMY_CU='10000000';db.prepare('INSERT INTO network_alchemy_budgets VALUES(?,?)').run(new Date().toISOString().slice(0,10),1499990);
  await expect(alchemyRead(env,'eth_getBalance',[wallet,'latest'])).rejects.toThrow('budget exhausted');expect(fetcher).not.toHaveBeenCalled();
 });
 it('supports a higher daily budget while enforcing its hard ceiling',async()=>{
  const{db,env}=fixture();env.NETWORK_ALCHEMY_CU='10000000';env.NETWORK_ALCHEMY_CU_PER_DAY='99999999';
  const today=new Date().toISOString().slice(0,10);
  db.prepare('INSERT INTO network_alchemy_budgets VALUES(?,?)').run(today,3999980);
  const fetcher=vi.fn(async()=>rpc('0x0'));vi.stubGlobal('fetch',fetcher);
  await alchemyRead(env,'eth_getBalance',[]);
  await expect(alchemyRead(env,'eth_getBalance',[])).rejects.toThrow('budget exhausted');
  expect(fetcher).toHaveBeenCalledTimes(1);expect(db.prepare('SELECT reserved FROM network_alchemy_budgets WHERE period=?').get(today)?.reserved).toBe(4000000);
 });
 it('cannot raise the monthly hard cap through configuration',async()=>{
  const{db,env}=fixture();env.NETWORK_ALCHEMY_CU='30000000';
  const today=new Date().toISOString().slice(0,10),prior=today.slice(0,7)+'-01';
  db.prepare('INSERT INTO network_alchemy_budgets VALUES(?,?)').run(prior,9999990);
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  await expect(alchemyRead(env,'eth_getBalance',[])).rejects.toThrow('budget exhausted');expect(fetcher).not.toHaveBeenCalled();
 });
 it('reserves atomically across concurrent readers and counts failed calls',async()=>{
  const{db,env}=fixture();env.NETWORK_ALCHEMY_CU='20';const fetcher=vi.fn(async()=>{throw Error('provider failed');});vi.stubGlobal('fetch',fetcher);
  const results=await Promise.allSettled([alchemyRead(env,'eth_getBalance',[]),alchemyRead(env,'eth_getBalance',[])]);
  expect(results.every(r=>r.status==='rejected')).toBe(true);expect(fetcher).toHaveBeenCalledTimes(1);expect(db.prepare('SELECT SUM(reserved) total FROM network_alchemy_budgets').get()?.total).toBe(20);
 });
 it('values each distinct batch wallet once, shares the lease and overlaps bounded readers',async()=>{
  const{db,env}=fixture();const wallets=Array.from({length:4},(_,i)=>'0x'+String(i+1).repeat(40));
  for(let i=1;i<=4;i++){
   if(i>2)db.prepare("INSERT INTO network_profiles(fid,location_status,token_status,opt_in_status,observed_at) VALUES(?,'unknown','none','opted_in',1)").run(i);
   db.prepare('INSERT INTO network_confirmed(fid,observed_at) VALUES(?,1)').run(i);
   db.prepare('INSERT INTO network_wallet_links VALUES(?,?,1)').run(i,wallets[i-1]);
  }
  db.prepare('INSERT INTO network_wallet_links VALUES(?,?,1)').run(2,wallets[0]);
  db.prepare('INSERT INTO network_asset_prices VALUES(?,?,?)').run(NATIVE_ASSET,JSON.stringify({price:2000,confidence:1,timestamp:Math.floor(Date.now()/1000)}),Date.now());
  let active=0,peak=0;const calls:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{
   const r=JSON.parse(String(init.body));calls.push(r.method+':'+r.params[0]);active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,160));active--;
   return rpc(r.method==='eth_getBalance'?'0x0':{address:r.params[0],tokenBalances:[]});
  }));
  const pending=importWalletBatch(env,25,4);expect((await importWalletValue(env)).status).toBe('busy');
  const result=await pending;
  expect(result.status).toBe('advanced');expect('results' in result&&result.results).toHaveLength(4);
  expect(db.prepare('SELECT COUNT(*) n FROM network_wallet_values').get()?.n).toBe(4);
  expect(new Set(calls).size).toBe(8);expect(calls).toHaveLength(8);expect(peak).toBeGreaterThan(1);expect(peak).toBeLessThanOrEqual(4);
  expect(db.prepare('SELECT SUM(reserved) n FROM network_alchemy_budgets').get()?.n).toBe(160);
  expect(db.prepare("SELECT COUNT(*) n FROM network_leases WHERE name='wallet-values'").get()?.n).toBe(0);
 });
 it('settles parallel readers before releasing the lease at the budget cap',async()=>{
  const{db,env}=fixture();env.NETWORK_ALCHEMY_CU='60';
  for(let i=1;i<=2;i++){db.prepare('INSERT INTO network_confirmed(fid,observed_at) VALUES(?,1)').run(i);db.prepare('INSERT INTO network_wallet_links VALUES(?,?,1)').run(i,'0x'+String(i).repeat(40));}
  let active=0;const fetcher=vi.fn(async(_url:string,init:RequestInit)=>{active++;await new Promise(resolve=>setTimeout(resolve,40));active--;const r=JSON.parse(String(init.body));return rpc(r.method==='eth_getBalance'?'0x0':{address:r.params[0],tokenBalances:[]});});vi.stubGlobal('fetch',fetcher);
  db.prepare('INSERT INTO network_asset_prices VALUES(?,?,?)').run(NATIVE_ASSET,JSON.stringify({price:2000,confidence:1,timestamp:Math.floor(Date.now()/1000)}),Date.now());
  await expect(importWalletBatch(env,25,4)).rejects.toThrow('budget exhausted');
  expect(active).toBe(0);expect(fetcher.mock.calls.length).toBeLessThanOrEqual(3);
  expect(db.prepare('SELECT SUM(reserved) n FROM network_alchemy_budgets').get()?.n).toBeLessThanOrEqual(60);
  expect(db.prepare("SELECT COUNT(*) n FROM network_leases WHERE name='wallet-values'").get()?.n).toBe(0);
 });
 it('never propagates a key-bearing URL or provider error text',async()=>{
  const{env}=fixture();vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('https://base-mainnet.g.alchemy.com/v2/'+env.ALCHEMY_API_KEY);}));
  await expect(alchemyRead(env,'eth_getBalance',[])).rejects.toThrow('Alchemy request failed');
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({jsonrpc:'2.0',id:1,error:{message:env.ALCHEMY_API_KEY}})));
  await expect(alchemyRead(env,'eth_getBalance',[])).rejects.toThrow(/^Alchemy RPC request rejected$/);
 });
 it('collects all token pages and native balance, caching paid metadata',async()=>{
  const{db,env}=fixture();const calls:string[]=[];vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{
   expect(url).toBe('https://base-mainnet.g.alchemy.com/v2/'+env.ALCHEMY_API_KEY);expect(init.redirect).toBe('manual');
   const request=JSON.parse(String(init.body));calls.push(request.method);
   if(request.method==='alchemy_getTokenMetadata')return rpc({name:'Dollar',symbol:'USD',decimals:6});
   if(request.method==='eth_getBalance')return rpc('0x10');
   if(request.params[2].pageKey)return rpc({address:wallet,tokenBalances:[{contractAddress:spam,tokenBalance:'0x0'}]});
   return rpc({address:wallet,tokenBalances:[{contractAddress:token,tokenBalance:'0x2'}],pageKey:'next'});
  }));
  expect(await alchemyWalletBalances(env,wallet)).toEqual({native:'16',tokens:[{address:token,balance:'2'}],unavailable:[]});
  await alchemyTokenMetadata(env,token);await alchemyTokenMetadata(env,token);
  expect(calls.filter(m=>m==='alchemy_getTokenMetadata')).toHaveLength(1);
  expect(db.prepare('SELECT SUM(reserved) total FROM network_alchemy_budgets').get()?.total).toBe(70);
 });
 it('finishes a large wallet beyond the old 100-page boundary without losing later tokens',async()=>{
  const{db,env}=fixture();let page=0;
  vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{
   db.exec('DELETE FROM network_alchemy_rate');
   const request=JSON.parse(String(init.body));
   if(request.method==='eth_getBalance')return rpc('0x10');
   expect(request.params[2].pageKey).toBe(page?String(page):undefined);
   page++;return rpc({address:wallet,tokenBalances:[{contractAddress:'0x'+page.toString(16).padStart(40,'0'),tokenBalance:page===101?'0x2':'0x0'}],...(page<101?{pageKey:String(page)}:{})});
  }));
  expect(await alchemyWalletBalances(env,wallet)).toEqual({native:'16',tokens:[{address:'0x'+(101).toString(16).padStart(40,'0'),balance:'2'}],unavailable:[]});
  expect(page).toBe(101);expect(db.prepare('SELECT SUM(reserved) n FROM network_alchemy_budgets').get()?.n).toBe(2040);
 });
 it('keeps a finite pagination ceiling and does not report a truncated wallet as valued',async()=>{
  const{db,env}=fixture();env.NETWORK_ALCHEMY_CU='100000';let calls=0;
  vi.stubGlobal('fetch',vi.fn(async()=>{
   db.exec('DELETE FROM network_alchemy_rate');calls++;
   return rpc({address:wallet,tokenBalances:[],pageKey:String(calls)});
  }));
  await expect(alchemyWalletBalances(env,wallet)).rejects.toThrow('pagination cap reached');
  expect(calls).toBe(1000);expect(db.prepare('SELECT SUM(reserved) n FROM network_alchemy_budgets').get()?.n).toBe(20000);
 });
 it('rejects missing balances and repeated pagination instead of recording zero',async()=>{
  const{env}=fixture();vi.stubGlobal('fetch',vi.fn(async()=>rpc({address:wallet,tokenBalances:[{contractAddress:token,tokenBalance:null}]})));
  await expect(alchemyWalletBalances(env,wallet)).rejects.toThrow('Invalid Alchemy token balance');
  vi.stubGlobal('fetch',vi.fn(async()=>rpc({address:wallet,tokenBalances:[],pageKey:'repeat'})));
  await expect(alchemyWalletBalances(env,wallet)).rejects.toThrow('pagination');
 });
 it('values priced assets independently and skips metadata for unpriced tokens without Neynar calls',async()=>{
  const{db,env}=fixture();db.prepare('INSERT INTO network_confirmed(fid,observed_at) VALUES(1,?)').run(Date.now());db.prepare('INSERT INTO network_wallet_links VALUES(?,?,?)').run(1,wallet,Date.now());env.NEYNAR_API_KEY='unused';env.NETWORK_WALLET_CREDITS='1';
  for(const[id,quote]of[[NATIVE_ASSET,{price:2000,confidence:1,timestamp:Math.floor(Date.now()/1000)}],['eip155:8453/erc20:'+token,{price:1.25,decimals:6,confidence:1,timestamp:Math.floor(Date.now()/1000)}],['eip155:8453/erc20:'+spam,null]]as const)db.prepare('INSERT INTO network_asset_prices VALUES(?,?,?)').run(id,JSON.stringify(quote),Date.now());
  let metadata=0;vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{expect(url).toContain('base-mainnet.g.alchemy.com');const r=JSON.parse(String(init.body));if(r.method==='eth_getBalance')return rpc('0xde0b6b3a7640000');if(r.method==='alchemy_getTokenMetadata'){metadata++;expect(r.params[0]).toBe(token);return rpc({name:'Dollar',symbol:'USD',decimals:6});}return rpc({address:wallet,tokenBalances:[{contractAddress:token,tokenBalance:'0x1e8480'},{contractAddress:spam,tokenBalance:null,error:'execution reverted'}]});}));
  expect(await importWalletValue(env)).toMatchObject({status:'valued',excluded:1,pricedAssets:2});
  expect(db.prepare('SELECT usd_units,source FROM network_wallet_values').get()).toEqual({usd_units:'200250000000',source:'alchemy-base+defillama'});expect(metadata).toBe(1);expect(db.prepare('SELECT COUNT(*) n FROM network_credit_budgets').get()?.n).toBe(0);
 });
 it('defers a wallet when a reliably priced token has an unavailable balance',async()=>{
  const{db,env}=fixture();db.prepare('INSERT INTO network_confirmed(fid,observed_at) VALUES(1,?)').run(Date.now());db.prepare('INSERT INTO network_wallet_links VALUES(?,?,?)').run(1,wallet,Date.now());db.prepare('INSERT INTO network_wallet_values(address,usd_units,positions,excluded,observed_at) VALUES(?,?,?,?,?)').run(wallet,'123','[]',0,0);
  for(const id of [NATIVE_ASSET,'eip155:8453/erc20:'+token])db.prepare('INSERT INTO network_asset_prices VALUES(?,?,?)').run(id,JSON.stringify({price:1,decimals:6,confidence:1,timestamp:Math.floor(Date.now()/1000)}),Date.now());
  vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>JSON.parse(String(init.body)).method==='eth_getBalance'?rpc('0x0'):rpc({address:wallet,tokenBalances:[{contractAddress:token,tokenBalance:null,error:'execution reverted'}]})));
  expect(await importWalletValue(env)).toMatchObject({status:'retry',reason:'Priced Alchemy token balance unavailable'});expect(db.prepare('SELECT usd_units FROM network_wallet_values').get()?.usd_units).toBe('123');
 });
 it('refreshes a recent Neynar value through Alchemy before unmeasured wallets',async()=>{
  const{db,env}=fixture();
  for(const fid of [1,2])db.prepare('INSERT INTO network_confirmed(fid,observed_at) VALUES(?,?)').run(fid,Date.now());
  db.prepare('INSERT INTO network_wallet_links VALUES(?,?,?)').run(1,wallet,Date.now());db.prepare('INSERT INTO network_wallet_links VALUES(?,?,?)').run(2,spam,Date.now());
  db.prepare('INSERT INTO network_wallet_values(address,usd_units,positions,excluded,observed_at,source) VALUES(?,?,?,?,?,?)').run(wallet,'123','[]',0,Date.now(),'neynar-base+defillama');
  db.prepare('INSERT INTO network_asset_prices VALUES(?,?,?)').run(NATIVE_ASSET,JSON.stringify({price:2000,confidence:1,timestamp:Math.floor(Date.now()/1000)}),Date.now());
  vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>{const r=JSON.parse(String(init.body));expect(r.params[0]).toBe(wallet);return r.method==='eth_getBalance'?rpc('0xde0b6b3a7640000'):rpc({address:wallet,tokenBalances:[]});}));
  expect((await importWalletValue(env)).status).toBe('valued');
  expect(db.prepare('SELECT usd_units,source FROM network_wallet_values WHERE address=?').get(wallet)).toEqual({usd_units:'200000000000',source:'alchemy-base+defillama'});
  expect(db.prepare('SELECT COUNT(*) n FROM network_wallet_values WHERE address=?').get(spam)?.n).toBe(0);
 });
 it('preserves the last value after a partial response and releases its lease',async()=>{
  const{db,env}=fixture();db.prepare('INSERT INTO network_confirmed(fid,observed_at) VALUES(1,?)').run(Date.now());db.prepare('INSERT INTO network_wallet_links VALUES(?,?,?)').run(1,wallet,Date.now());db.prepare('INSERT INTO network_wallet_values(address,usd_units,positions,excluded,observed_at) VALUES(?,?,?,?,?)').run(wallet,'123','[]',0,0);
  vi.stubGlobal('fetch',vi.fn(async()=>rpc({address:wallet,tokenBalances:[],pageKey:'repeat'})));
  expect((await importWalletValue(env)).status).toBe('retry');expect(db.prepare('SELECT usd_units FROM network_wallet_values').get()?.usd_units).toBe('123');expect(db.prepare('SELECT COUNT(*) n FROM network_leases').get()?.n).toBe(0);
 });
});

import {alchemyWalletBalances,alchemyTokenMetadata} from './alchemy';
import { networkFetchJson } from './source';
import { bounded, reserveRequest, syncGet, syncSet, type NetworkEnv } from './store';
const ADDRESS = /^0x[a-f0-9]{40}$/i;
export interface WalletEnv extends NetworkEnv { NEYNAR_API_KEY?: string; NETWORK_WALLET_CREDITS?: string; ALCHEMY_API_KEY?: string; NETWORK_ALCHEMY_CU?: string }
export const NATIVE_ASSET = 'eip155:8453/slip44:60';
export interface PricedPosition { id: string; symbol: string; name: string; balance: string; decimals: number; priceUsd: string; usdUnits: string; quotedAt: number }
export function decimalScale(value: string, decimals: number): bigint {
  const match = value.match(/^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
  if (!match || value.length > 120) throw Error('Invalid decimal amount');
  const power = decimals + Number(match[3] ?? 0) - (match[2]?.length ?? 0);
  if (!Number.isSafeInteger(power) || Math.abs(power) > 200) throw Error('Decimal overflow');
  const digits = BigInt(match[1] + (match[2] ?? ''));
  return power >= 0 ? digits * 10n ** BigInt(power) : digits / 10n ** BigInt(-power);
}
export function assetId(address: string) { return /^0x(e{40}|0{40})$/i.test(address) ? NATIVE_ASSET : `eip155:8453/erc20:${address.toLowerCase()}`; }
export function acceptedQuote(value: unknown, asset: string, now = Date.now()): { price: number; timestamp: number; decimals?: number; symbol?: string } | null {
  if (!value || typeof value !== 'object') return null;
  const q = value as { price: number; timestamp: number; decimals?: number; symbol?: string; confidence: number };
  if (!Number.isFinite(q.price) || q.price <= 0 || q.confidence < .95 || !Number.isFinite(q.confidence) || !Number.isSafeInteger(q.timestamp) || q.timestamp * 1000 < now - 7_200_000 || q.timestamp * 1000 > now + 300_000) return null;
  if (asset !== NATIVE_ASSET && (!Number.isSafeInteger(q.decimals) || q.decimals! < 0 || q.decimals! > 36)) return null;
  return q;
}
export async function neynarRead(env: WalletEnv, path: string, maximumCredits: number, target: 'api' | 'snapchain' = 'api') {
  if (!env.NEYNAR_API_KEY) throw Error('Existing Neynar key is required');
  const limit = bounded(env.NETWORK_WALLET_CREDITS, 100_000, 10_000_000);
  const month = new Date().toISOString().slice(0, 7);
  const reserved = await env.WARPLETS.prepare(`INSERT INTO network_credit_budgets(month,reserved) SELECT ?,? WHERE ?<=?
    ON CONFLICT(month) DO UPDATE SET reserved=network_credit_budgets.reserved+excluded.reserved WHERE network_credit_budgets.reserved+excluded.reserved<=? RETURNING reserved`)
    .bind(month, maximumCredits, maximumCredits, limit, limit).first();
  if (!reserved) throw Error('Network wallet credit cap reached');
  await reserveRequest(env, 'neynar-wallets');
  const host=target==='snapchain'?'snapchain-api.neynar.com':'api.neynar.com';
  const payload=await networkFetchJson(`https://${host}${path}`, { headers: { 'x-api-key': env.NEYNAR_API_KEY } }, 2_000_000);
  const page=payload as {balances?:unknown[];next?:{cursor?:unknown}};
  if(path.startsWith('/v2/onchain/token/balances?')&&Array.isArray(page.balances)&&page.balances.length<=100&&page.next&&Object.hasOwn(page.next,'cursor')) {
    const refund=maximumCredits-Math.max(1,page.balances.length)*10;
    if(refund>0)await env.WARPLETS.prepare('UPDATE network_credit_budgets SET reserved=reserved-? WHERE month=?').bind(refund,month).run();
  }
  return payload;
}
async function quoteAssets(env: WalletEnv, assets: string[]) {
  const quotes = new Map<string, unknown>();
  const missing: string[] = [];
  const cachedAssets=new Map<string,{payload:string;observed_at:number}>();
  for(let i=0;i<assets.length;i+=90){const batch=assets.slice(i,i+90);const result=await env.WARPLETS.prepare(`SELECT asset,payload,observed_at FROM network_asset_prices WHERE asset IN (${batch.map(()=>'?').join(',')})`).bind(...batch).all<{asset:string;payload:string;observed_at:number}>();for(const row of result.results)cachedAssets.set(row.asset,row);}
  for (const asset of assets) {
    const cached=cachedAssets.get(asset);
    if (cached && cached.observed_at > Date.now() - (cached.payload==='null'?86_400_000:3_600_000)) quotes.set(asset, JSON.parse(cached.payload));
    else missing.push(asset);
  }
  for (let i=0;i<missing.length;i+=50) {
    const batch = missing.slice(i,i+50);
    const keys = batch.map(asset => asset === NATIVE_ASSET ? 'coingecko:ethereum' : `base:${asset.split('erc20:')[1]}`);
    await reserveRequest(env,'defillama-prices');
    const data = await networkFetchJson(`https://coins.llama.fi/prices/current/${keys.join(',')}`, {}, 500_000) as { coins: Record<string,unknown> };
    if (!data.coins || typeof data.coins !== 'object' || Array.isArray(data.coins)) throw Error('Invalid independent price snapshot');
    const now=Date.now();
    await env.WARPLETS.batch(batch.map((asset,index) => { const quote=acceptedQuote(data.coins[keys[index]],asset,now); quotes.set(asset,quote); return env.WARPLETS.prepare('INSERT INTO network_asset_prices(asset,payload,observed_at) VALUES(?,?,?) ON CONFLICT(asset) DO UPDATE SET payload=excluded.payload,observed_at=excluded.observed_at').bind(asset,JSON.stringify(quote),now); }));
  }
  return quotes;
}
export async function refreshWalletPrices(env: WalletEnv) {
  if(await syncGet(env.WARPLETS,'wallet_price_refresh',0)>Date.now()-3_600_000)return;
  const rows=await env.WARPLETS.prepare("SELECT asset FROM network_asset_prices WHERE payload<>'null'").all<{asset:string}>();
  await quoteAssets(env,rows.results.map(row=>row.asset));
  await syncSet(env.WARPLETS,'wallet_price_refresh',Date.now());
}
interface Balance { network: string; address: string; balance: string; decimals: number; name?: string; symbol?: string }
export function priceBalances(rows: Balance[], quotes: Map<string,unknown>, now = Date.now()) {
  const positions: PricedPosition[] = []; let excluded=0; const seen=new Set<string>();
  for (const row of rows) {
    if (row.network !== 'base' || !ADDRESS.test(row.address) || !/^\d{1,80}$/.test(row.balance) || BigInt(row.balance)>(1n<<256n)-1n) throw Error('Invalid Base token balance');
    const id=assetId(row.address);
    if (seen.has(id)) throw Error('Duplicate asset in wallet balance pages'); seen.add(id);
    if (BigInt(row.balance)===0n) continue;
    if(!Number.isSafeInteger(row.decimals)||row.decimals<0||row.decimals>36){excluded++;continue;}
    const quote=acceptedQuote(quotes.get(id),id,now);
    if (!quote || row.decimals !== (id===NATIVE_ASSET?18:quote.decimals)) { excluded++; continue; }
    const units=BigInt(row.balance)*decimalScale(String(quote.price),24)/10n**BigInt(row.decimals)/10n**16n;
    positions.push({id,symbol:String(quote.symbol??row.symbol??'').slice(0,24),name:String(row.name??quote.symbol??id).slice(0,100),balance:row.balance,decimals:row.decimals,priceUsd:String(quote.price),usdUnits:units.toString(),quotedAt:quote.timestamp*1000});
  }
  return {positions,excluded,usdUnits:positions.reduce((sum,p)=>sum+BigInt(p.usdUnits),0n).toString()};
}
async function valueNextWallet(env: WalletEnv) {
  if (await syncGet(env.WARPLETS,'wallet_cooldown',0)>Date.now()) return {status:'cooldown'};
  const legacy=env.ALCHEMY_API_KEY?"v.address IS NOT NULL AND v.source<>'alchemy-base+defillama'":'0';
  const row=await env.WARPLETS.prepare(`SELECT l.address FROM network_wallet_links l JOIN (SELECT fid FROM network_events UNION SELECT fid FROM network_confirmed) c ON c.fid=l.fid LEFT JOIN network_wallet_values v ON v.address=l.address LEFT JOIN network_wallet_retries r ON r.address=l.address
    WHERE (v.address IS NULL OR v.observed_at<? OR (${legacy})) AND (r.address IS NULL OR r.retry_after<?) GROUP BY l.address ORDER BY CASE WHEN (${legacy}) THEN 0 ELSE 1 END,(v.address IS NULL) DESC,COALESCE(v.observed_at,0),MIN(l.fid),l.address LIMIT 1`).bind(Date.now()-(env.ALCHEMY_API_KEY?7:1)*86_400_000,Date.now()).first<{address:string}>();
  if (!row) {
    const remaining=await env.WARPLETS.prepare(`SELECT COUNT(DISTINCT l.address) n FROM network_wallet_links l JOIN (SELECT fid FROM network_events UNION SELECT fid FROM network_confirmed) c ON c.fid=l.fid LEFT JOIN network_wallet_values v ON v.address=l.address WHERE v.address IS NULL OR v.observed_at<? OR (${legacy})`).bind(Date.now()-(env.ALCHEMY_API_KEY?7:1)*86_400_000).first<{n:number}>();
    return {status:remaining?.n?'waiting':'complete'};
  }
  try {
    const balances: Balance[]=[];
    let result:ReturnType<typeof priceBalances>;
    if(env.ALCHEMY_API_KEY) {
      const raw=await alchemyWalletBalances(env,row.address);
      const quotes=await quoteAssets(env,[NATIVE_ASSET,...raw.tokens.map(token=>assetId(token.address)),...raw.unavailable.map(assetId)]);
      balances.push({network:'base',address:'0x'+'e'.repeat(40),balance:raw.native,decimals:18,name:'Ether',symbol:'ETH'});
      for(const token of raw.tokens) {
        const quote=acceptedQuote(quotes.get(assetId(token.address)),assetId(token.address));
        // Unpriced tokens need no paid metadata call. They still count as excluded.
        const metadata=quote?await alchemyTokenMetadata(env,token.address):null;
        balances.push({network:'base',...token,decimals:metadata?.decimals??-1,name:metadata?.name,symbol:metadata?.symbol});
      }
      if(raw.unavailable.some(address=>acceptedQuote(quotes.get(assetId(address)),assetId(address))))throw Error('Priced Alchemy token balance unavailable');
      result=priceBalances(balances,quotes);
      result.excluded+=raw.unavailable.length;
    } else {
    let cursor=''; const cursors=new Set<string>(); let done=false;
    for (let page=0;page<20;page++) {
      const data=await neynarRead(env,`/v2/onchain/token/balances?networks=base&address=${row.address}&limit=100${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`,1000) as {balances:Balance[];next:{cursor:string|null}};
      if (!Array.isArray(data.balances) || data.balances.length>100 || !data.next || !Object.hasOwn(data.next,'cursor')) throw Error('Incomplete wallet balance page');
      balances.push(...data.balances);
      if (!data.next.cursor) {done=true;break;}
      if (typeof data.next.cursor!=='string' || data.next.cursor.length>2000 || cursors.has(data.next.cursor)) throw Error('Invalid wallet pagination');
      cursor=data.next.cursor;cursors.add(cursor);
    }
    if (!done) throw Error('Wallet pagination cap reached');
    const assets=[...new Set(balances.filter(b=>typeof b.address==='string'&&ADDRESS.test(b.address)&&typeof b.balance==='string'&&/^\d{1,80}$/.test(b.balance)&&BigInt(b.balance)>0n).map(b=>assetId(b.address)))];
    result=priceBalances(balances,await quoteAssets(env,assets));
    }
    const oldest=result.positions.length?Math.min(...result.positions.map(p=>p.quotedAt)):null;
    await env.WARPLETS.prepare(`INSERT INTO network_wallet_values(address,usd_units,positions,excluded,observed_at,price_oldest_at,source) VALUES(?,?,?,?,?,?,?) ON CONFLICT(address) DO UPDATE SET usd_units=excluded.usd_units,positions=excluded.positions,excluded=excluded.excluded,observed_at=excluded.observed_at,price_oldest_at=excluded.price_oldest_at,source=excluded.source`)
      .bind(row.address,result.usdUnits,JSON.stringify(result.positions),result.excluded,Date.now(),oldest,env.ALCHEMY_API_KEY?'alchemy-base+defillama':'neynar-base+defillama').run();
    await env.WARPLETS.prepare('DELETE FROM network_wallet_retries WHERE address=?').bind(row.address).run();
    return {status:'valued',excluded:result.excluded,pricedAssets:result.positions.length};
  } catch(error) {
    const message=error instanceof Error?error.message:'';
    if (/credit cap|budget exhausted|Alchemy rate pause|Alchemy key is missing or invalid/.test(message)) throw error;
    await env.WARPLETS.prepare('INSERT INTO network_wallet_retries(address,retry_after) VALUES(?,?) ON CONFLICT(address) DO UPDATE SET retry_after=excluded.retry_after').bind(row.address,Date.now()+3_600_000).run();
    if (/HTTP (429|401|402|403)|Alchemy RPC request rejected/.test(message)) {await syncSet(env.WARPLETS,'wallet_cooldown',Date.now()+900_000);throw error;}
    return {status:'retry',reason:/^(Invalid Alchemy|Duplicate Alchemy|Alchemy pagination|Priced Alchemy)/.test(message)?message:'Source read failed; retry deferred'};
  }
}
export async function importWalletValue(env: WalletEnv) {
  const owner=crypto.randomUUID(),now=Date.now();
  const lease=await env.WARPLETS.prepare(`INSERT INTO network_leases(name,owner,expires_at) VALUES('wallet-values',?,?) ON CONFLICT(name) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE network_leases.expires_at<? RETURNING owner`).bind(owner,now+1_800_000,now).first<{owner:string}>();
  if(lease?.owner!==owner)return {status:'busy'};
  try{return await valueNextWallet(env);}finally{await env.WARPLETS.prepare("DELETE FROM network_leases WHERE name='wallet-values' AND owner=?").bind(owner).run();}
}
export async function importWalletAssociations(env: WalletEnv, batch = 100) {
  if(await syncGet(env.WARPLETS,'wallet_cooldown',0)>Date.now())return 0;
  const rows = await env.WARPLETS.prepare(`SELECT c.fid FROM (SELECT fid FROM network_events UNION SELECT fid FROM network_confirmed) c
    LEFT JOIN network_wallet_associations a ON a.fid=c.fid WHERE a.fid IS NULL OR a.observed_at<? ORDER BY COALESCE(a.observed_at,0),c.fid LIMIT ?`)
    .bind(Date.now() - 86_400_000, Math.min(100, batch)).all<{ fid: number }>();
  if (!rows.results.length) return 0;
  const fids = rows.results.map(row => row.fid);
  const payload = await neynarRead(env, `/v2/farcaster/user/bulk?fids=${fids.join(',')}`, fids.length * 2) as { users: { fid: number; verified_addresses?: { eth_addresses?: unknown } }[] };
  if (!Array.isArray(payload.users) || payload.users.length !== fids.length || new Set(payload.users.map(user => user.fid)).size !== fids.length || payload.users.some(user => !fids.includes(user.fid) || !Array.isArray(user.verified_addresses?.eth_addresses))) throw Error('Incomplete verified-wallet associations');
  const at = Date.now();
  for (const user of payload.users) {
    const raw = user.verified_addresses!.eth_addresses as unknown[];
    if (raw.length > 500 || raw.some(address => typeof address !== 'string' || !ADDRESS.test(address))) throw Error('Invalid verified EVM address');
    const addresses = [...new Set((raw as string[]).map(address => address.toLowerCase()))];
    await env.WARPLETS.batch([
      env.WARPLETS.prepare('DELETE FROM network_wallet_links WHERE fid=?').bind(user.fid),
      ...addresses.map(address => env.WARPLETS.prepare('INSERT INTO network_wallet_links(fid,address,observed_at) VALUES(?,?,?)').bind(user.fid,address,at)),
      env.WARPLETS.prepare(`INSERT INTO network_wallet_associations(fid,observed_at) VALUES(?,?) ON CONFLICT(fid) DO UPDATE SET observed_at=excluded.observed_at`).bind(user.fid,at),
    ]);
  }
  await syncSet(env.WARPLETS, 'wallet_association_success', at);
  return fids.length;
}

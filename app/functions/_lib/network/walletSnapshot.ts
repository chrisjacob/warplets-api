import { NETWORK_CURRENT_PROFILE } from './cohort';
import { NETWORK_RECORD_REFRESH_HOURS } from '../../../shared/network/refresh';
import type { NetworkCell, WalletSnapshot, NetworkToken } from '../../../shared/network/model';
import { acceptedQuote, decimalScale, NATIVE_ASSET, type PricedPosition } from './wallets';
type Account = { known: boolean; expected: number; ambiguous: number; measured: number; usd: bigint; excluded: number; assets: Map<string,bigint> };
export async function walletSnapshot(db: D1Database) {
  const seeds=await db.prepare(`SELECT p.fid,a.fid IS NOT NULL AS known FROM network_profiles p LEFT JOIN network_wallet_associations a ON a.fid=p.fid WHERE ${NETWORK_CURRENT_PROFILE}`).all<{fid:number;known:number}>();
  const accounts=new Map<number,Account>(seeds.results.map(row=>[row.fid,{known:Boolean(row.known),expected:0,ambiguous:0,measured:0,usd:0n,excluded:0,assets:new Map()}]));
  const summary:WalletSnapshot={associationsObserved:seeds.results.filter(a=>a.known).length,expectedWallets:0,measuredWallets:0,unallocatedUsdUnits:'0',oldestBalanceAt:null,latestBalanceAt:null,oldestPriceAt:null,excludedBalances:0,tokens:[]};
  const catalog=new Map<string,NetworkToken>(); let unallocated=0n;
  // Capture the cohort once, then seek links by indexed FID. The previous
  // grouped CTEs repeatedly scanned/grouped the full cohort and ownership set.
  const linked=await db.prepare('SELECT l.fid,l.address FROM json_each(?) c CROSS JOIN network_wallet_links l ON l.fid=c.value').bind(JSON.stringify([...accounts.keys()])).all<{fid:number;address:string}>();
  const owners=new Map<string,{owners:number;fid:number}>();
  for(const row of linked.results){
    const owner=owners.get(row.address);
    if(owner){owner.owners++;owner.fid=Math.min(owner.fid,row.fid);}else owners.set(row.address,{owners:1,fid:row.fid});
    accounts.get(row.fid)!.expected++;
  }
  for(const row of linked.results)if(owners.get(row.address)!.owners>1)accounts.get(row.fid)!.ambiguous++;
  linked.results.length=0;seeds.results.length=0;
  const prices=new Map((await db.prepare("SELECT asset,payload FROM network_asset_prices WHERE payload<>'null'").all<{asset:string;payload:string}>()).results.map(row=>[row.asset,JSON.parse(row.payload) as unknown]));
  summary.expectedWallets=owners.size;
  let cursor='';
  for(;;){
    const rows=await db.prepare(`SELECT address,usd_units,positions,excluded,observed_at,price_oldest_at,source FROM network_wallet_values WHERE address>? ORDER BY address LIMIT 500`).bind(cursor).all<{address:string;usd_units:string;positions:string;excluded:number;observed_at:number;price_oldest_at:number|null;source:string}>();
    for(const row of rows.results){
      const owner=owners.get(row.address);if(!owner)continue;
      summary.balanceRefreshHours=NETWORK_RECORD_REFRESH_HOURS;
      summary.measuredWallets++;summary.excludedBalances+=row.excluded;
      summary.oldestBalanceAt=Math.min(summary.oldestBalanceAt??row.observed_at,row.observed_at);summary.latestBalanceAt=Math.max(summary.latestBalanceAt??row.observed_at,row.observed_at);
      const positions=JSON.parse(row.positions??'[]') as PricedPosition[];
      for(const p of positions){const quote=acceptedQuote(prices.get(p.id),p.id);if(quote&&typeof p.balance==='string'&&p.decimals===(p.id===NATIVE_ASSET?18:quote.decimals)){p.usdUnits=(BigInt(p.balance)*decimalScale(String(quote.price),24)/10n**BigInt(p.decimals)/10n**16n).toString();p.quotedAt=quote.timestamp*1000;}}
      const usd=positions.reduce((sum,p)=>sum+BigInt(p.usdUnits),0n);
      const quoted=positions.length?Math.min(...positions.map(p=>p.quotedAt).filter(at=>Number.isFinite(at))):row.price_oldest_at;
      if(quoted!==null&&Number.isFinite(quoted))summary.oldestPriceAt=Math.min(summary.oldestPriceAt??quoted,quoted);
      for(const p of positions)catalog.set(p.id,{id:p.id,name:p.name,symbol:p.symbol});
      if(owner.owners!==1){unallocated+=usd;continue;}
      const account=accounts.get(owner.fid)!;account.usd+=usd;account.measured++;account.excluded+=row.excluded;
      for(const p of positions)account.assets.set(p.id,(account.assets.get(p.id)??0n)+BigInt(p.usdUnits));
    }
    if(rows.results.length<500)break;
    cursor=rows.results.at(-1)!.address;
  }
  summary.unallocatedUsdUnits=unallocated.toString();summary.tokens=[...catalog.values()].sort((a,b)=>a.id.localeCompare(b.id));
  const existing=new Map((await db.prepare('SELECT fid,asset,status FROM network_holdings').all<{fid:number;asset:string|null;status:string}>()).results.map(row=>[row.fid,row]));
  const presentation=new Map<number,{held:string;walletUsdUnits:string;portfolioValues:string[]}>();
  const writes:D1PreparedStatement[]=[];
  for(const [fid,a] of accounts){
    let held='unavailable',status='unavailable';
    if(a.known&&a.ambiguous){held='ambiguous';status='ambiguous';}
    else if(a.known&&a.measured===a.expected){
      if(a.expected===0){held='none';status='no-wallet';}
      else {const top=[...a.assets].filter(([,value])=>value>0n).sort(([idA,a],[idB,b])=>a===b?idA.localeCompare(idB):a>b?-1:1)[0];held=top?.[0]??(a.excluded?'unpriced':'none');status='measured';}
    }
    presentation.set(fid,{held,walletUsdUnits:a.usd.toString(),portfolioValues:status==='measured'?[a.usd.toString()]:[]});
    const old=existing.get(fid),asset=held.startsWith('eip155:')?held:null;
    if(!old||old.asset!==asset||old.status!==held)writes.push(db.prepare('INSERT INTO network_holdings(fid,asset,status,calculated_at) VALUES(?,?,?,?) ON CONFLICT(fid) DO UPDATE SET asset=excluded.asset,status=excluded.status,calculated_at=excluded.calculated_at').bind(fid,asset,held,Date.now()));
  }
  for(let i=0;i<writes.length;i+=100)await db.batch(writes.slice(i,i+100));
  return {summary,presentation};
}
export function mergeWalletCells(rows:(NetworkCell&{fid:number})[], presentation:Awaited<ReturnType<typeof walletSnapshot>>['presentation']) {
  const cells=new Map<string,NetworkCell>();
  for(const row of rows){const {fid,...profile}=row;const wallet=presentation.get(fid)??{held:'unavailable',walletUsdUnits:'0',portfolioValues:[]};const key=JSON.stringify([profile.country,profile.state??null,profile.city??null,profile.location,profile.token,profile.tokenStatus,profile.vote,profile.acceptedDay,wallet.held,profile.activityMonths??[],profile.warpletHolder??false,profile.ogMember??null]);const previous=cells.get(key);
    if(previous){previous.count++;previous.walletUsdUnits=(BigInt(previous.walletUsdUnits??'0')+BigInt(wallet.walletUsdUnits)).toString();previous.portfolioValues!.push(...wallet.portfolioValues);}
    else cells.set(key,{...profile,count:1,...wallet,portfolioValues:[...wallet.portfolioValues]});
  }
  return [...cells.values()];
}

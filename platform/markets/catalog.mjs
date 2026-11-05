import {decode58} from '../server/base58.mjs';
import {launchFeeBps,CAMPAIGN_SECONDS} from '../domain/economics/launch.mjs';
import {transaction} from '../storage/database.mjs';
import {failure,json} from '../server/api.mjs';
const route='/api/v1/markets';
const iso=ms=>new Date(ms).toISOString();
function input(raw) {
  if(!raw||typeof raw!=='object') throw new Error('Expected one market fixture.');
  const {id,symbol,ogSymbol,activatedAt,attMint,ogMint,poolAddress}=raw;
  if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)||typeof id!=='string') throw new Error('Invalid market identifier.');
  for(const name of [symbol,ogSymbol]) if(typeof name!=='string'||!/^[A-Za-z0-9._-]{1,24}$/.test(name)) throw new Error('Invalid market symbol.');
  for(const key of [attMint,ogMint,poolAddress]) decode58(key,32);
  if(new Set([attMint,ogMint,poolAddress]).size!==3) throw new Error('Mint and pool keys must differ.');
  const ms=Date.parse(activatedAt);
  if(!Number.isSafeInteger(ms)||ms<0||iso(ms)!==activatedAt||ms%1000!==0) throw new Error('Use UTC with whole seconds and .000Z.');
  return {id,symbol,ogSymbol,activatedAt,attMint,ogMint,poolAddress,source:'local-fixture'};
}
export function importMarket(db,raw) {
  const record=input(raw),body=JSON.stringify(record);
  return transaction(db,()=>{
    const old=db.prepare('SELECT body FROM market_fixtures WHERE id=?').get(record.id);
    if(old) {
      if(old.body!==body) throw new Error('Market fixture conflicts with its stored identity.');
      return record;
    }
    db.prepare('INSERT INTO market_fixtures(id,att_mint,pool_address,body) VALUES(?,?,?,?)')
      .run(record.id,record.attMint,record.poolAddress,body);
    return record;
  });
}
function view(body,ms) {
  const record=JSON.parse(body),start=BigInt(Date.parse(record.activatedAt)/1000),at=BigInt(Math.floor(ms/1000));
  return {...record,chain:'solana',status:at<start?'scheduled':at-start<CAMPAIGN_SECONDS?'active':'campaign-ended',
    feeBps:at<start?null:Number(launchFeeBps({activatedAt:start,at})),executable:false};
}
const schedule=Array.from({length:91},(_,elapsedSeconds)=>({elapsedSeconds,
  feeBps:Number(launchFeeBps({activatedAt:0n,at:BigInt(elapsedSeconds)}))}));
export function handleMarkets(db,request,now) {
  const url=new URL(request.url),path=url.pathname;
  if(path!==route&&!path.startsWith(route+'/')&&path!=='/api/v1/launch/fee-schedule')return null;
  if(request.method!=='GET') return failure(405,'method_not_allowed','Use GET.',{allow:'GET'});
  if(path==='/api/v1/launch/fee-schedule')return json({points:schedule,unit:'basis-points',clock:'actual-activation'});
  if(path!==route){
    const row=db.prepare('SELECT body FROM market_fixtures WHERE id=?').get(path.slice(route.length+1));
    return row?json(view(row.body,now)):failure(404,'market_not_found','Unknown market.');
  }
  const params=url.searchParams;
  if([...params.keys()].some(key=>!['limit','cursor'].includes(key)||params.getAll(key).length!==1))
    return failure(400,'invalid_filter','Unsupported or repeated query parameter.');
  const str=params.get('limit')??'25',limit=Number(str);
  if(!/^[1-9][0-9]{0,2}$/.test(str)||limit>100)return failure(400,'invalid_limit','Use a page size between 1 and 100.');
  const high=db.prepare('SELECT COALESCE(MAX(seq),0) AS n FROM market_fixtures').get().n;
  let watermark=high,at=now,before=high+1;
  if(params.has('cursor')){
    try {
      const value=params.get('cursor');
      if(value.length>160||!/^[A-Za-z0-9_-]+$/.test(value))throw Error();
      const arr=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));
      if(!Array.isArray(arr)||arr.length!==3||!arr.every(n=>Number.isSafeInteger(n)&&n>=0))throw Error();
      [watermark,at,before]=arr;
      if(watermark>high||at>now||before>watermark||before<1)throw Error();
    }catch{return failure(400,'invalid_cursor','Invalid catalog cursor.');}
  }
  const rows=db.prepare('SELECT seq,body FROM market_fixtures WHERE seq<=? AND seq<? ORDER BY seq DESC LIMIT ?').all(watermark,before,limit+1);
  const more=rows.length>limit,page=rows.slice(0,limit);
  const nextCursor=more?Buffer.from(JSON.stringify([watermark,at,page.at(-1).seq])).toString('base64url'):null;
  return json({items:page.map(row=>view(row.body,at)),nextCursor,snapshotId:'fixture-'+watermark+'-'+at,asOf:iso(at)});
}
export const marketPaths={
  '/markets':{get:{operationId:'listMarkets',parameters:[
    {in:'query',name:'limit',schema:{type:'integer',minimum:1,maximum:100,default:25}},
    {in:'query',name:'cursor',schema:{type:'string'}}],responses:{200:{description:'Local fixture page with stable as-of time and cursor'}}}},
  '/markets/{id}':{get:{operationId:'getMarket',parameters:[{in:'path',name:'id',required:true,schema:{type:'string'}}],responses:{200:{description:'Read-only market detail'},404:{description:'Unknown market'}}}},
  '/launch/fee-schedule':{get:{operationId:'getFeeSchedule',responses:{200:{description:'Fee basis points for elapsed seconds zero through ninety'}}}}
};

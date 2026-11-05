import {decode58} from '../server/base58.mjs';
import {transaction} from '../storage/database.mjs';
import {launchAllocations,CAMPAIGN_SECONDS} from '../domain/economics/launch.mjs';
import {simulateStakeFarm} from '../domain/economics/stake.mjs';
import {timestamp} from '../vault/ledger.mjs';
import {currentSession} from '../server/auth.mjs';
import {json,failure} from '../server/api.mjs';

const base='/api/v1';
const sec=ms=>BigInt(Math.floor(ms/1000));
const iso=ms=>new Date(ms).toISOString();
const decimal=value=>{
 if(typeof value!=='string'||!/^(0|[1-9]\d{0,19})$/.test(value))throw Error('Expected a decimal base-unit string.');
 return BigInt(value);
};
function farm(db,id) {return db.prepare('SELECT * FROM stake_fixture_farms WHERE market_id=?').get(id);}
export function seedFarm(db,{marketId,originalUnits,treasuryFeeBps}) {
 const market=db.prepare('SELECT body FROM market_fixtures WHERE id=?').get(marketId);
 if(!market)throw Error('Import the underlying market fixture first.');
 if(!Number.isInteger(treasuryFeeBps)||treasuryFeeBps<0||treasuryFeeBps>10000)throw Error('Specify a hypothetical harvest fee in basis points.');
 const units=String(launchAllocations({supply:decimal(originalUnits),activeSeasonWeight:0n}).stake);
 const at=timestamp(JSON.parse(market.body).activatedAt);
 return transaction(db,()=>{
  const old=farm(db,marketId);
  if(old&&(old.original_units!==originalUnits||old.treasury_fee_bps!==treasuryFeeBps))throw Error('Conflicting farm configuration.');
  if(!old)db.prepare('INSERT INTO stake_fixture_farms VALUES(?,?,?,?,?)').run(marketId,at,originalUnits,units,treasuryFeeBps);
  return {marketId,fundedUnits:units,source:'local-fixture'};
 });
}
function trace(db,row,ms) {
 const events=db.prepare('SELECT * FROM stake_fixture_events WHERE market_id=? AND at_ms<=? ORDER BY at_ms,seq LIMIT 1001').all(row.market_id,ms);
 return simulateStakeFarm({activatedAt:sec(row.activation_ms),budget:BigInt(row.funded_units),treasuryFeeBps:BigInt(row.treasury_fee_bps),
  through:sec(ms),events:events.map(e=>({id:e.id,kind:e.kind,wallet:e.wallet,at:sec(e.at_ms),amount:e.amount===null?undefined:decimal(e.amount)}))});
}
export function observeFarm(db,{id,marketId,wallet,at,amount,kind},now=Date.now()){
 const row=farm(db,marketId);if(!row)throw Error('Unknown farm.');
 if(typeof id!=='string'||!/^[A-Za-z0-9:_-]{1,128}$/.test(id))throw Error('Invalid event ID.');
 decode58(wallet,32);const ms=timestamp(at);
 if(ms>now||ms<row.activation_ms)throw Error('Event outside observable period.');
 if(!['deposit','withdraw','harvest'].includes(kind))throw Error('Unknown farm event.');
 if(kind==='harvest'){if(amount!==undefined)throw Error('Harvest takes no amount.');}
 else if(decimal(amount)<=0n)throw Error('Expected a positive amount.');
 return transaction(db,()=>{
  const prior=db.prepare('SELECT * FROM stake_fixture_events WHERE id=?').get(id);
  if(prior) {
   if(prior.market_id!==marketId||prior.wallet!==wallet||prior.at_ms!==ms||prior.kind!==kind||prior.amount!==(amount??null))
    throw Error('Event ID conflict.');
   return {id,replayed:true};
  }
  const stats=db.prepare('SELECT COUNT(*) AS n,MAX(at_ms) AS latest FROM stake_fixture_events WHERE market_id=?').get(marketId);
  if(stats.n>=1000||stats.latest>ms)throw Error('Fixture event cap or order violated.');
  db.prepare('INSERT INTO stake_fixture_events(id,market_id,kind,wallet,at_ms,amount) VALUES(?,?,?,?,?,?)').run(id,marketId,kind,wallet,ms,amount??null);
  trace(db,row,ms); // Verify the resulting position before committing the observation.
  return {id,replayed:false};
 });
}
function describe(db,row,ms,wallet){
 const common={marketId:row.market_id,fundedUnits:row.funded_units,treasuryFeeBps:row.treasury_fee_bps,
  activationTime:iso(row.activation_ms),emissionEnd:iso(row.activation_ms+Number(CAMPAIGN_SECONDS)*1000),
  asOf:iso(ms),source:'local-fixture',executable:false};
 if(ms<row.activation_ms)return {...common,status:'scheduled'};
 const state=trace(db,row,ms);
 if(wallet){
  const p=state.balances.find(p=>p.wallet===wallet);
  return {...common,principalUnits:String(p?.principal??0n),earnedGrossUnits:String(p?.earnedGross??0n),
   claimableGrossUnits:String(p?.claimableGross??0n),harvestedGrossUnits:String(p?.harvestedGross??0n)};
 }
 return {...common,status:sec(ms)>=sec(row.activation_ms)+CAMPAIGN_SECONDS?'ended':'active',
  totalStakedUnits:String(state.totalPrincipal),earnedGrossUnits:String(state.earnedGross),
  unusedRecoverableUnits:String(state.recoverableIdle),roundingReserveUnits:String(state.roundingReserve)};
}
export function handleStake(db,request,now){
 const {pathname,searchParams}=new URL(request.url);
 const match=pathname.match(/^\/api\/v1\/farms\/([a-z0-9-]{1,64})$/);
 if(!match&&pathname!==base+'/stake/positions')return null;
 if(request.method!=='GET')return failure(405,'method_not_allowed','Use GET.',{allow:'GET'});
 if(match){const row=farm(db,match[1]);return row?json(describe(db,row,now)):failure(404,'farm_not_found','Unknown local farm.');}
 const session=currentSession(db,request,now);if(!session)return failure(401,'authentication_required','Connect your wallet.');
 const after=searchParams.get('cursor')??'';
 if(!/^[a-z0-9-]{0,64}$/.test(after))return failure(400,'invalid_cursor','Invalid position cursor.');
 const rows=db.prepare(`SELECT f.* FROM stake_fixture_farms f JOIN (SELECT DISTINCT market_id FROM stake_fixture_events
 WHERE wallet=? AND market_id>? AND at_ms<=? ORDER BY market_id LIMIT 26) e ON f.market_id=e.market_id ORDER BY f.market_id`).all(session.wallet,after,now);
 return json({items:rows.slice(0,25).map(row=>describe(db,row,now,session.wallet)),nextCursor:rows.length>25?rows[24].market_id:null,asOf:iso(now)});
}
export const stakePaths={
 '/stake/positions':{get:{operationId:'getStakePositions',responses:{200:{description:'Owner positions including claimed and continuously earned units'},401:{description:'Session required'}}}},
 '/farms/{id}':{parameters:[{in:'path',name:'id',required:true,schema:{type:'string'}}],get:{operationId:'getFarm',responses:{200:{description:'Local farm funding and hypothetical harvest fee'},404:{description:'Unknown farm'}}}}
};

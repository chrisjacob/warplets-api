import {decode58} from '../server/base58.mjs';
import {transaction} from '../storage/database.mjs';
import {launchAllocations} from '../domain/economics/launch.mjs';
import {decimal,projectTrace,describeFarm} from './projection.mjs';
import {timestamp} from '../vault/ledger.mjs';
import {currentSession} from '../server/auth.mjs';
import {json,failure} from '../server/api.mjs';

const base='/api/v1';
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
function readEvents(db,row,ms) {
 return db.prepare('SELECT * FROM stake_fixture_events WHERE market_id=? AND at_ms<=? ORDER BY at_ms,seq LIMIT 1001').all(row.market_id,ms);
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
  projectTrace(row,ms,readEvents(db,row,ms)); // Verify the resulting position before committing the observation.
  return {id,replayed:false};
 });
}
function describe(db,row,ms,wallet){return describeFarm(row,ms,wallet,readEvents(db,row,ms));}
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
 return json({items:rows.slice(0,25).map(row=>describe(db,row,now,session.wallet)),nextCursor:rows.length>25?rows[24].market_id:null,asOf:new Date(now).toISOString()});
}
export const stakePaths={
 '/stake/positions':{get:{operationId:'getStakePositions',responses:{200:{description:'Owner positions including claimed and continuously earned units'},401:{description:'Session required'}}}},
 '/farms/{id}':{parameters:[{in:'path',name:'id',required:true,schema:{type:'string'}}],get:{operationId:'getFarm',responses:{200:{description:'Local farm funding and hypothetical harvest fee'},404:{description:'Unknown farm'}}}}
};

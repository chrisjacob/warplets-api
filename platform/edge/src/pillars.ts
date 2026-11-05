import {Hono} from 'hono';
import {getCookie} from 'hono/cookie';
import {z} from 'zod';
import {sessionOwner,sessionCookie,boundedInput} from './wallet';
import {projectEntitlement} from '../../vault/projection.mjs';
import {describeFarm} from '../../stake/projection.mjs';
import {claimableUnits} from '../../domain/earn/settlement.mjs';
import {BALLOT_CHOICES} from '../../domain/collections/ballot.mjs';

export const pillars=new Hono<{Bindings:Env}>();
type Asset={id:string;coords:string};
type Row=Record<string,string|number|null>;
const iso=(ms:number)=>new Date(ms).toISOString();
const cursor=z.string().regex(/^[A-Za-z0-9._:-]{0,128}$/);
const fail=(code:string,message:string)=>({error:{code,message}});
const now=()=>Date.now();

// Keep projections on the same integer arithmetic as the reference adapter.
pillars.get('/nfts/:id/vault',async c=>{
  const at=now(),after=c.req.query('cursor')??'';
  if(!cursor.safeParse(after).success)return c.json(fail('invalid_cursor','Invalid Vault cursor.'),400);
  const key=c.req.param('id');
  const asset=await c.env.DB.prepare('SELECT id,coords FROM vault_assets WHERE id=?').bind(key).first<Asset>();
  if(!asset)return c.json(fail('asset_not_found','Unknown NFT.'),404);
  const reveal=await c.env.DB.prepare('SELECT reveal_ms FROM collect_assets WHERE id=?').bind(key).first<{reveal_ms:number|null}>();
  if(reveal&&(reveal.reveal_ms===null||reveal.reveal_ms>at))return c.json(fail('metadata_unrevealed','Vault detail becomes available after reveal.'),409);
  const manifests=await c.env.DB.prepare(`SELECT m.*,COALESCE(t.claimed,'0') AS claimed FROM vault_manifests m
    LEFT JOIN vault_claim_totals t ON t.launch_id=m.id AND t.asset_id=? WHERE m.id>? AND m.activated_ms<=? ORDER BY m.id LIMIT 26`).bind(key,after,at).all<Row>();
  const rows=manifests.results;
  return c.json({assetId:key,slot:JSON.parse(asset.coords),source:'local-fixture',asOf:iso(at),
    items:rows.slice(0,25).map(row=>projectEntitlement(asset,row,at,row.claimed)),nextCursor:rows.length>25?rows[24].id:null});
});
pillars.get('/vault',async c=>{
  const owner=await sessionOwner(c.req.raw,c.env.DB,getCookie(c,sessionCookie));
  if(!owner)return c.json(fail('authentication_required','Connect your wallet.'),401);
  const after=c.req.query('cursor')??'';
  if(!cursor.safeParse(after).success)return c.json(fail('invalid_cursor','Invalid cursor.'),400);
  const {results}=await c.env.DB.prepare('SELECT id FROM vault_assets WHERE owner=? AND id>? ORDER BY id LIMIT 26').bind(owner,after).all<{id:string}>();
  return c.json({items:results.slice(0,25).map(({id})=>({id,detail:'/api/v1/nfts/'+encodeURIComponent(id)+'/vault'})),
    nextCursor:results.length>25?results[24].id:null,source:'local-fixture',asOf:iso(now())});
});
const eventSQL='SELECT * FROM stake_fixture_events WHERE market_id=? AND at_ms<=? ORDER BY at_ms,seq LIMIT 1001';
pillars.get('/farms/:id',async c=>{
  const id=c.req.param('id'),at=now();
  const [farm,events]=await c.env.DB.batch<Row>([c.env.DB.prepare('SELECT * FROM stake_fixture_farms WHERE market_id=?').bind(id),
    c.env.DB.prepare(eventSQL).bind(id,at)]);
  if(!farm.results.length)return c.json(fail('farm_not_found','Unknown local farm.'),404);
  return c.json(describeFarm(farm.results[0],at,null,events.results));
});
pillars.get('/stake/positions',async c=>{
  const wallet=await sessionOwner(c.req.raw,c.env.DB,getCookie(c,sessionCookie));
  if(!wallet)return c.json(fail('authentication_required','Connect your wallet.'),401);
  const after=c.req.query('cursor')??'',at=now();
  if(!cursor.safeParse(after).success)return c.json(fail('invalid_cursor','Invalid cursor.'),400);
  const {results:rows}=await c.env.DB.prepare(`SELECT f.* FROM stake_fixture_farms f JOIN
    (SELECT DISTINCT market_id FROM stake_fixture_events WHERE wallet=? AND market_id>? AND at_ms<=? ORDER BY market_id LIMIT 26)
    e ON e.market_id=f.market_id ORDER BY f.market_id`).bind(wallet,after,at).all<Row>();
  const page=rows.slice(0,25);
  const events=page.length?await c.env.DB.batch(page.map(f=>c.env.DB.prepare(eventSQL).bind(f.market_id,at))):[];
  return c.json({items:page.map((row,i)=>describeFarm(row,at,wallet,events[i].results)),nextCursor:rows.length>25?rows[24].market_id:null,asOf:iso(at)});
});
pillars.get('/earn/epochs/:epoch/leaderboard',async c=>{
  const date=c.req.param('epoch'),ms=Date.parse(date+'T00:00:00Z');
  if(!/^\d{4}-\d\d-\d\d$/.test(date)||!Number.isSafeInteger(ms)||ms<0||iso(ms).slice(0,10)!==date)
    return c.json(fail('invalid_epoch','Use a UTC calendar date.'),400);
  const epoch=ms/86400000;
  const [boards,allocations]=await c.env.DB.batch<Row>([
    c.env.DB.prepare('SELECT snapshot_hash,finalized_ms,winners FROM earn_boards WHERE epoch=?').bind(epoch),
    c.env.DB.prepare('SELECT token_id AS tokenId,day,budget AS budgetUnits,burn AS burnUnits,vests_from_ms AS vestsFromMs,vests_through_ms AS vestsThroughMs FROM earn_allocations WHERE epoch=? ORDER BY token_id,day').bind(epoch)
  ]);
  const row=boards.results[0];
  return c.json({mode:'local-fixture',epoch,date,status:row?'final':'pending',items:row?JSON.parse(String(row.winners)).map((w:object,i:number)=>({rank:i+1,...w})):[],
    allocations:allocations.results,snapshotId:row?.snapshot_hash??null,finalizedAtMs:row?.finalized_ms??null});
});
pillars.get('/earn/claims',async c=>{
 const wallet=await sessionOwner(c.req.raw,c.env.DB,getCookie(c,sessionCookie));
 if(!wallet)return c.json(fail('authentication_required','Connect your wallet.'),401);
 const raw=c.req.query('cursor')??'0',after=Number(raw);
 if(!/^\d{1,15}$/.test(raw)||!Number.isSafeInteger(after))return c.json(fail('invalid_cursor','Invalid claim cursor.'),400);
 const {results}=await c.env.DB.prepare(`SELECT a.rowid AS cursor,a.token_id AS tokenId,a.day,a.amount,c.vests_from_ms AS vestsFromMs,
 c.vests_through_ms AS vestsThroughMs FROM earn_awards a JOIN earn_allocations c ON c.token_id=a.token_id AND c.day=a.day
 WHERE a.wallet=? AND a.rowid>? ORDER BY a.rowid LIMIT 51`).bind(wallet,after).all<Row>();
 return c.json({mode:'local-fixture',executionEnabled:false,items:results.slice(0,50).map(r=>({tokenId:r.tokenId,day:r.day,
   awardUnits:r.amount,vestedUnits:String(claimableUnits({awardedUnits:BigInt(String(r.amount)),claimedUnits:0n,window:r,nowMs:now()})),
   vestsFromMs:r.vestsFromMs,vestsThroughMs:r.vestsThroughMs})),nextCursor:results.length>50?results[49].cursor:null});
});
pillars.post('/genesis/ballots/:id/votes',async c=>{
 const origin=new URL(c.req.url).origin;
 if(c.req.header('origin')!==origin)return c.json(fail('invalid_origin','Use the configured local origin.'),403);
 const wallet=await sessionOwner(c.req.raw,c.env.DB,getCookie(c,sessionCookie));
 if(!wallet)return c.json(fail('authentication_required','Connect your wallet.'),401);
 const data=z.object({choice:z.enum(['ASAP','7','14','30'])}).strict().safeParse(await boundedInput(c.req.raw));
 if(!data.success)return c.json(fail('invalid_choice','Choose a published ballot option.'),422);
 const choice=data.data.choice,id=c.req.param('id'),at=now();
 // One conditional insert is the admission decision. Requests cannot choose a wallet or timestamp.
 const [write,vote,ballot,eligible]=await c.env.DB.batch<Row>([
  c.env.DB.prepare(`INSERT INTO genesis_votes SELECT b.id,v.wallet,?,? FROM genesis_ballots b JOIN genesis_voters v ON v.ballot_id=b.id
    WHERE v.wallet=? AND b.id=? AND b.opens_ms<=? AND b.closes_ms>? ON CONFLICT(ballot_id,wallet) DO NOTHING`).bind(choice,at,wallet,id,at,at),
  c.env.DB.prepare('SELECT choice FROM genesis_votes WHERE ballot_id=? AND wallet=?').bind(id,wallet),
  c.env.DB.prepare('SELECT id FROM genesis_ballots WHERE id=?').bind(id),
  c.env.DB.prepare('SELECT 1 FROM genesis_voters WHERE ballot_id=? AND wallet=?').bind(id,wallet)]);
 if(write.meta.changes)return c.json({choice,replayed:false},201);
 if(vote.results[0]?.choice===choice)return c.json({choice,replayed:true});
 if(!ballot.results.length)return c.json(fail('ballot_not_found','Unknown ballot.'),404);
 if(!eligible.results.length)return c.json(fail('voter_ineligible','Wallet outside electorate.'),403);
 return c.json(fail(vote.results.length?'wallet_already_voted':'ballot_closed','Vote could not be recorded.'),409);
});
const ballotSummary=async(db:D1Database,row:Row,at:number)=>{
 const [tally,decisions]=await db.batch<Row>([
   db.prepare('SELECT choice,COUNT(*) AS n FROM genesis_votes WHERE ballot_id=? GROUP BY choice').bind(row.id),
   db.prepare('SELECT choice,rationale,earliest_ms FROM genesis_decisions WHERE ballot_id=?').bind(row.id)]);
 const closed=at>=Number(row.closes_ms),decision=decisions.results[0],counts=closed?Object.fromEntries(BALLOT_CHOICES.map(c=>[c,0])):null;
 let votesCast=0;
 for(const entry of tally.results){votesCast+=Number(entry.n);if(counts)counts[String(entry.choice)]=Number(entry.n);}
 return {id:row.id,source:'local-fixture',status:closed?'closed':at<Number(row.opens_ms)?'scheduled':'open',opensAt:iso(Number(row.opens_ms)),
 closesAt:iso(Number(row.closes_ms)),choices:BALLOT_CHOICES,eligibleWallets:row.eligible_count,votesCast,counts,
 decision:decision?{choice:decision.choice,rationale:decision.rationale,earliestOpening:iso(Number(decision.earliest_ms))}:null};
};
pillars.get('/genesis/ballots',async c=>{
 const {results}=await c.env.DB.prepare('SELECT * FROM genesis_ballots ORDER BY opens_ms DESC,id LIMIT 10').all<Row>();
 const at=now();return c.json({items:await Promise.all(results.map(row=>ballotSummary(c.env.DB,row,at))),nextCursor:null,asOf:iso(at)});
});
pillars.get('/genesis/ballots/:id',async c=>{
 const row=await c.env.DB.prepare('SELECT * FROM genesis_ballots WHERE id=?').bind(c.req.param('id')).first<Row>();
 return row?c.json(await ballotSummary(c.env.DB,row,now())):c.json(fail('ballot_not_found','Unknown ballot.'),404);
});

import {Hono} from 'hono';
import {getCookie} from 'hono/cookie';
import {z} from 'zod';
import {sessionOwner,sessionCookie,boundedInput} from './wallet';
import {BALLOT_CHOICES} from '../../domain/collections/ballot.mjs';

export const pillars=new Hono<{Bindings:Env}>();
type Row=Record<string,string|number|null>;
const iso=(ms:number)=>new Date(ms).toISOString();
const fail=(code:string,message:string)=>({error:{code,message}});
const now=()=>Date.now();

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

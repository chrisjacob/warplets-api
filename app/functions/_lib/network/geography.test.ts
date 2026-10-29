import { afterEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { sqliteD1 } from '../sqliteTestDb';
import { resolveNetworkLocation } from './geography';
import { saveProfile, publishSnapshot } from './store';
import { networkCountry, networkLocationParts, normalizeNetworkProfile } from '../../../shared/network/normalize';
import { parseNetworkFilters, validateNetworkParams } from '../../../shared/network/model';
import { buildNetworkDashboard } from './aggregate';
import { readNetworkMembers } from './members';
const databases:DatabaseSync[]=[];
afterEach(()=>databases.splice(0).forEach(db=>db.close()));
function fixture(){const db=new DatabaseSync(':memory:');databases.push(db);for(const f of ['0095_network.sql','0096_network_members.sql','0097_network_wallets.sql','0098_network_activity.sql','0099_network_alchemy.sql','0100_network_geography.sql','0101_network_geography_matching.sql','0102_network_warplet_holders.sql','0103_network_warplet_images.sql'])db.exec(readFileSync(new URL(`../../../../migrations/${f}`,import.meta.url),'utf8'));
 for(const [id,country,name,aliases] of [['US.CA','US','California',['california','ca']],['US.NY','US','New York',['new york','ny']],['AU.02','AU','New South Wales',['new south wales','nsw']],['AU.07','AU','Victoria',['victoria','vic']]] as const)db.prepare('INSERT INTO network_geo_states VALUES(?,?,?,?)').run(id,country,name,JSON.stringify(aliases));
 for(const [id,country,state,name] of [['gn:1','US','US.CA','Los Angeles'],['gn:2','US','US.CA','Springfield'],['gn:3','US','US.NY','Springfield'],['gn:4','AU','AU.02','Sydney'],['gn:5','AU','AU.02','Albury'],['gn:6','AU','AU.07','Melbourne']] as const){db.prepare('INSERT INTO network_geo_cities VALUES(?,?,?,?,?,?)').run(id,country,state,name,1,1);db.prepare('INSERT INTO network_geo_aliases VALUES(?,?,?)').run(country,name.toLowerCase(),id);}
 return {db,d1:sqliteD1(db)};}
it('matches explicit state/city hierarchies and leaves ambiguous names unresolved',async()=>{const {d1}=fixture();expect(await resolveNetworkLocation(d1,'Los Angeles, CA, USA','US')).toEqual({state:'US.CA',city:'gn:1'});expect(await resolveNetworkLocation(d1,'Sydney NSW, Australia','AU')).toEqual({state:'AU.02',city:'gn:4'});expect(await resolveNetworkLocation(d1,'Sydney, Australia','AU')).toEqual({state:'AU.02',city:'gn:4'});expect(await resolveNetworkLocation(d1,'Springfield, USA','US')).toEqual({state:null,city:null});expect(await resolveNetworkLocation(d1,'Springfield, NY, USA','US')).toEqual({state:'US.NY',city:'gn:3'});expect(await resolveNetworkLocation(d1,'CA, USA','US')).toEqual({state:'US.CA',city:null});expect(await resolveNetworkLocation(d1,'Los Angeles','US')).toEqual({state:null,city:null});expect(await resolveNetworkLocation(d1,'Los Angeles, Invalid, USA','US')).toEqual({state:null,city:null});});
it('rejects orphan and mismatched parent filters and repeated parameters',()=>{for(const query of ['city=gn:1','state=US.CA','country=AU&state=US.CA','country=US&state=UNKNOWN&city=gn:1','country=US&state=US.CA&city=bad'])expect(()=>parseNetworkFilters(new URLSearchParams(query))).toThrow();expect(()=>validateNetworkParams(new URLSearchParams('state=US.CA&state=US.NY'))).toThrow();expect(parseNetworkFilters(new URLSearchParams('country=US&state=US.CA&city=gn:1'))).toMatchObject({state:'US.CA',city:'gn:1'});});
it('keeps geography, wallet grouping, KPIs and member selections reconciled at every level',async()=>{const {db,d1}=fixture();let fid=0;for(const location of ['Los Angeles, CA, USA','Los Angeles, CA, USA','CA, USA','USA','Springfield, NY, USA','Earth']){fid++;db.prepare('INSERT INTO network_confirmed(fid,observed_at) VALUES(?,?)').run(fid,100);await saveProfile(d1,normalizeNetworkProfile({result:{user:{fid,username:`user${fid}`,profile:{location:{description:location,placeId:'public-place'}},viewerContext:{optInStatus:'opted_in'}}}},fid,Date.now()));}
 const snapshot=await publishSnapshot(d1,true);expect(snapshot?.population).toBe(6);expect(snapshot?.cells).toHaveLength(5);expect(snapshot?.geography?.cities).toHaveLength(2);
 for(const query of ['', 'country=US','country=US&state=US.CA','country=US&state=US.CA&city=gn:1','country=US&state=UNKNOWN','country=US&state=US.CA&city=UNKNOWN','country=US&state=US.CA&city=gn:3']){const params=new URLSearchParams(query),view=buildNetworkDashboard(snapshot,parseNetworkFilters(params));expect((await readNetworkMembers(d1,params)).total).toBe(view.population);expect(view.geography?.rows.reduce((sum,r)=>sum+(r.population??0),0)).toBe(view.population);expect((view.geography?.mapped??0)+(view.geography?.unmapped??0)).toBe(view.population);expect((view.coverage.known??0)+(view.coverage.unknown??0)+(view.coverage.unavailable??0)).toBe(view.population);}
 const states=buildNetworkDashboard(snapshot,parseNetworkFilters(new URLSearchParams('country=US')));expect(states.countryCatalog?.map(p=>p.id)).toContain('UNKNOWN');expect(states.countryCatalog?.map(p=>p.id)).toContain('US');
 expect(states.geography?.rows.map(p=>[p.id,p.population])).toEqual([['US.CA',3],['US.NY',1],['UNKNOWN',1]]);
 // Clearing public location removes stale city assignment on the next snapshot.
 await saveProfile(d1,normalizeNetworkProfile({result:{user:{fid:1,profile:{location:{description:''}}}}},1,Date.now()));expect(db.prepare('SELECT state,city FROM network_profile_locations WHERE fid=1').get()).toEqual({state:null,city:null});
});

it('resolves Australian city/state/postcode formats without treating postcode or street text as location evidence',async()=>{const {d1}=fixture();
 for(const description of ['Albury NSW 2640, Australia','Albury, NSW 2640, Australia'])expect(await resolveNetworkLocation(d1,description,'AU')).toEqual({state:'AU.02',city:'gn:5'});
 expect(await resolveNetworkLocation(d1,'Sydney NSW 2000, Australia','AU')).toEqual({state:'AU.02',city:'gn:4'});
 expect(await resolveNetworkLocation(d1,'Melbourne VIC 3004, Australia','AU')).toEqual({state:'AU.07',city:'gn:6'});
 expect(await resolveNetworkLocation(d1,'NSW 2640, Australia','AU')).toEqual({state:'AU.02',city:null});
 expect(await resolveNetworkLocation(d1,'Albury 2640, Australia','AU')).toEqual({state:'AU.02',city:'gn:5'});
 expect(await resolveNetworkLocation(d1,'10 Example Street NSW 2640, Australia','AU')).toEqual({state:'AU.02',city:null});
 expect(await resolveNetworkLocation(d1,'Albury NSW 26400, Australia','AU')).toEqual({state:null,city:null});
});

it('parses explicit countries across global postcode and delimiter formats without guessing countries',()=>{
 for(const [text,country] of [['Kyiv, Ukraine, 02000','UA'],['Lviv, Lviv Oblast, Ukraine, 79000','UA'],['Dubai - United Arab Emirates','AE'],['Al Ain - Abu Dhabi - United Arab Emirates','AE'],['Riyadh Saudi Arabia','SA'],['946, Taiwan, 屏東縣恆春鎮山腳里','TW'],['Georgia, VT, USA','US'],['Germany, PA, USA','US'],['Paris, FR','FR'],['London, Ontario, Canada','CA']])expect(networkCountry(text)).toBe(country);
 for(const text of ['San Francisco, CA','Atlanta, GA','Toronto, CA','London','Earth','Somewhere','New Mexico','Northern Ireland','University of Georgia','France, Texas'])expect(networkCountry(text)).toBeNull();
 expect(networkLocationParts('Toronto, ON M5V 3L9, Canada').parts).toEqual(['Toronto','ON']);
 expect(networkLocationParts('London SW1A 1AA, UK').parts).toEqual(['London']);
 expect(networkLocationParts('47600 Francescas, France').parts).toEqual(['Francescas']);
 expect(networkLocationParts('Maharajganj, Uttar Pradesh 273303, India').parts).toEqual(['Maharajganj','Uttar Pradesh']);
 expect(networkLocationParts('Phuket, Phuket 83000, Thailand').parts).toEqual(['Phuket','Phuket']);
 expect(networkLocationParts('90 Nuremberg, Germany').parts).toEqual(['90 Nuremberg']);
});
it('distinguishes cities, administrative names, exact primary names and ambiguous aliases worldwide',async()=>{
 const {db,d1}=fixture();
 const state=(id:string,country:string,name:string,aliases:string[])=>db.prepare('INSERT OR REPLACE INTO network_geo_states VALUES(?,?,?,?)').run(id,country,name,JSON.stringify(aliases));
 const city=(id:string,country:string,parent:string,name:string,aliases:string[]=[])=>{db.prepare('INSERT INTO network_geo_cities VALUES(?,?,?,?,?,?)').run(id,country,parent,name,1,1);db.prepare('INSERT INTO network_geo_primary_names VALUES(?,?,?)').run(country,name.toLowerCase(),id);for(const alias of [name.toLowerCase(),...aliases])db.prepare('INSERT OR IGNORE INTO network_geo_aliases VALUES(?,?,?)').run(country,alias,id);};
 state('DE.16','DE','Berlin',['berlin']);city('gn:100','DE','DE.16','Berlin');
 expect(await resolveNetworkLocation(d1,'Berlin, Germany','DE')).toEqual({state:'DE.16',city:'gn:100'});
 state('KR.11','KR','Seoul',['seoul']);city('gn:101','KR','KR.11','Seoul');
 expect(await resolveNetworkLocation(d1,'Seoul, South Korea','KR')).toEqual({state:'KR.11',city:'gn:101'});
 state('BR.27','BR','São Paulo',['sao paulo']);city('gn:102','BR','BR.27','Sao Paulo');
 expect(await resolveNetworkLocation(d1,'Sao Paulo, State of Sao Paulo, Brazil','BR')).toEqual({state:'BR.27',city:'gn:102'});
 state('IT.07','IT','Lazio',['lazio']);city('gn:103','IT','IT.07','Roma',['rome']);
 db.prepare('INSERT INTO network_geo_parent_names VALUES(?,?,?,?)').run('IT','rome','IT.07','IT.07.RM');db.prepare('INSERT INTO network_geo_city_admin VALUES(?,?)').run('gn:103','IT.07.RM');
 expect(await resolveNetworkLocation(d1,'Rome, Metropolitan City of Rome Capital, Italy','IT')).toEqual({state:'IT.07',city:'gn:103'});
 expect(await resolveNetworkLocation(d1,'Rome, Invalid, Italy','IT')).toEqual({state:null,city:null});
 city('gn:104','US','US.NY','New York City',['new york']);
 expect(await resolveNetworkLocation(d1,'New York, NY 10001, USA','US')).toEqual({state:'US.NY',city:'gn:104'});
 expect(await resolveNetworkLocation(d1,'New York, USA','US')).toEqual({state:'US.NY',city:null});
 // Primary place names win over alternate names, without popularity-based ties.
 city('gn:105','US','US.CA','Old Village',['los angeles']);
 expect(await resolveNetworkLocation(d1,'Los Angeles, CA, USA','US')).toEqual({state:'US.CA',city:null}); // ambiguous unranked fixture aliases
 db.prepare('INSERT INTO network_geo_primary_names VALUES(?,?,?)').run('US','los angeles','gn:1');
 expect(await resolveNetworkLocation(d1,'Los Angeles, CA, USA','US')).toEqual({state:'US.CA',city:'gn:1'});
 state('AR.01','AR','Buenos Aires',['buenos aires']);state('AR.07','AR','Buenos Aires F.D.',['buenos aires']);city('gn:106','AR','AR.07','Buenos Aires');
 expect(await resolveNetworkLocation(d1,'Buenos Aires, Argentina','AR')).toEqual({state:'AR.07',city:'gn:106'});
 expect(await resolveNetworkLocation(d1,'Singapore','SG')).toEqual({state:null,city:null});
 expect(await resolveNetworkLocation(d1,'Hong Kong','HK')).toEqual({state:null,city:null});
});

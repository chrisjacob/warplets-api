import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { networkCountry } from '../../app/shared/network/normalize';
import { geoKey, resolveNetworkLocation } from '../../app/functions/_lib/network/geography';
const root=resolve(import.meta.dirname,'../..');
const db=new DatabaseSync(resolve(root,'.tmp/network-geo/gazetteer.sqlite'),{readOnly:true});
const d1={prepare(sql:string){let values:unknown[]=[];return{bind(...v:unknown[]){values=v;return this;},async all(){return{results:db.prepare(sql).all(...values as never[])};}};}} as unknown as D1Database;
const cases:[string,string|null,string|null,string|null|undefined][]=[
 ['Albury NSW 2640, Australia','AU','AU.02','Albury'],
 ['Toronto, ON M5V 3L9, Canada','CA','CA.08','Toronto'],
 ['London SW1A 1AA, UK','GB','GB.ENG','London'],
 ['New York, NY 10001, USA','US','US.NY','New York City'],
 ['Michigan City, IN 46360, USA','US','US.IN','Michigan City'],
 ['47600 Francescas, France','FR','FR.75','Francescas'],
 ['Paris, France','FR','FR.11','Paris'],
 ['Berlin, Germany','DE','DE.16','Berlin'],
 ['Seoul, South Korea','KR','KR.11','Seoul'],
 ['Dhaka, Bangladesh','BD','BD.81','Dhaka'],
 ['Rome, Metropolitan City of Rome Capital, Italy','IT','IT.07','Rome'],
 ['Milan, Metropolitan City of Milan, Italy','IT','IT.09','Milan'],
 ['São Paulo, State of São Paulo, Brazil','BR','BR.27','São Paulo'],
 ['Brasília - Brasilia, Brasília - Federal District, Brazil','BR','BR.07','Brasília'],
 ['Mexico City, CDMX, Mexico','MX','MX.09','Mexico City'],
 ['Manila, Metro Manila, Philippines','PH','PH.NCR','Manila'],
 ['Ho Chi Minh City, Vietnam','VN','VN.79','Ho Chi Minh City'],
 ['Kyiv, Ukraine, 02000','UA','UA.12','Kyiv'],
 ['Dubai - United Arab Emirates','AE','AE.03','Dubai'],
 ['Abu Dhabi - United Arab Emirates','AE','AE.01','Abu Dhabi'],
 ['Riyadh Saudi Arabia','SA','SA.10','Riyadh'],
 ['Abuja, Federal Capital Territory, Nigeria','NG','NG.11','Abuja'],
 ['Islamabad, Islamabad Capital Territory, Pakistan','PK','PK.08','Islamabad'],
 ['Kazan, Republic of Tatarstan, Russia','RU','RU.73','Kazan'],
 ['Bogotá, Bogota, Colombia','CO','CO.34','Bogotá'],
 ['Cali, Valle del Cauca, Colombia','CO','CO.29','Cali'],
 ['Buenos Aires, Argentina','AR','AR.07','Buenos Aires'],
 ['Los Angeles, Unknown district, CA, USA','US','US.CA','Los Angeles'],
 ['Los Angeles, Invalid, USA','US',null,null],
 ['Los Angeles, CA, NY, USA','US',null,null],
 ['Springfield, USA','US',null,null],
 ['Frankfurt, Germany','DE',null,null],
 ['New Mexico',null,null,null],
 ['Northern Ireland',null,null,null],
 ['University of Georgia',null,null,null],
 ['San Francisco, CA',null,null,null],
 ['Singapore','SG',null,null],
 ['Hong Kong','HK',null,null],
];
try{
 for(const [description,country,state,city] of cases){
  assert.equal(networkCountry(description),country,description+' country');
  const result=await resolveNetworkLocation(d1,description,country);assert.equal(result.state,state,description+' state');
  const record=result.city?db.prepare('SELECT name FROM network_geo_cities WHERE id=?').get(result.city) as {name:string}:null;
  if(city===null)assert.equal(record,null,description+' must remain ambiguous');
  else if(city!==undefined)assert.equal(geoKey(record?.name??''),geoKey(city),description+' city');
 }
 for(const [country,id,part] of [['FR','FR.11','france'],['IT','IT.07','lazio'],['AR','AR.07','buenos aires'],['VN','VN.79','ho chi minh']]){
  const shapes=JSON.parse(readFileSync(resolve(root,`app/public/network/states/${country}.json`),'utf8')) as {code:string;name:string}[];
  const s=shapes.find(s=>s.code===id);assert.ok(s&&geoKey(s.name).includes(part),`${country} boundary must use the canonical parent`);
 }
 for(const [id,forbidden] of [['FR.75','paris'],['VN.20','ho chi minh'],['AR.01','capital federal'],['PH.13','bulacan']]){
  const s=db.prepare('SELECT aliases FROM network_geo_states WHERE id=?').get(id) as {aliases:string};assert.ok(!(JSON.parse(s.aliases) as string[]).includes(forbidden),`${id} must not inherit unrelated subdivision aliases`);
 }
 console.log(JSON.stringify({status:'passed',realLocationCases:cases.length,boundaryChecks:8,upstreamRequests:0}));
}finally{db.close();}

export const NETWORK_GEOGRAPHY_VERSION='global-geography-v2';
import { networkLocationParts } from '../../../shared/network/normalize';
export function geoKey(value:string){return value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
export function geoVariants(value:string){
 const result=new Set([geoKey(value),geoKey(value.replace(/\([^)]{1,60}\)/g,''))]);
 for(const v of [...result]){
  const base=v.replace(/^(?:state of |republic of |respublika |province of |region of |federal territory of |special region of |metropolitan city of |citta metropolitana di |provincia di |provincia de |departamento del |departamento de |departement de |distrito capital de |estado de |estado do |estado da |county of |city of |municipality of |tinh |kota |kabupaten |quan |huyen |thanh pho )/,'')
   .replace(/ (?:province|state|republic|division|region|oblast|governorate|prefecture|regency|district|department|county|city|capital|capitale|capital territory|federal capital territory|d c|d f|f d)$/,'');
  if(base)result.add(base);
 }
 return [...result].filter(Boolean);
}
interface State{id:string;name:string;aliases:string}
interface Parent{state:string;admin2:string}
interface City{id:string;state:string}
const intersect=(a:Set<string>|null,b:Set<string>)=>a?new Set([...a].filter(v=>b.has(v))):b;
// Resolve only the explicit public description against canonical names/parents.
// Postal codes are formatting, never an independent source of residence.
export async function resolveNetworkLocation(db:D1Database,description:string,country:string|null){
 const empty={state:null as string|null,city:null as string|null};
 const parsed=networkLocationParts(description);
 if(!country||parsed.country!==country||!parsed.parts.length||parsed.parts.length>20)return empty;
 const parts=parsed.parts.map(part=>{
  const split=part.split(/\s+[-–—]\s+/);
  return split.length>1&&new Set(split.map(geoKey)).size===1?split[0]:part;
 });
 // Some geocoders repeat the city before an explicitly named subdivision.
 for(let i=1;i<parts.length;i++){
  const split=parts[i].split(/\s+[-–—]\s+/);
  if(split.length===2&&geoKey(split[0])===geoKey(parts[0]))parts[i]=split[1];
 }
 const states=(await db.prepare('SELECT id,name,aliases FROM network_geo_states WHERE country=?').bind(country).all<State>()).results;
 const stateMatches=(value:string)=>{
  const variants=geoVariants(value);
  // Exact source alias wins over a generalized administrative label.
  const exact=states.filter(s=>(JSON.parse(s.aliases) as string[]).includes(geoKey(value)));
  return exact.length?exact:states.filter(s=>(JSON.parse(s.aliases) as string[]).some(a=>variants.includes(a)));
 };
 let allowedStates:Set<string>|null=null,allowedParents:Set<string>|null=null,unresolvedParent=false,stateOnly=false,cityText=parts[0];
 for(const part of parts.slice(1)){
  const matches=stateMatches(part);
  if(matches.length){allowedStates=intersect(allowedStates,new Set(matches.map(s=>s.id)));continue;}
  let parents:Parent[]=[];
  for(const alias of [geoKey(part),...geoVariants(part).filter(a=>a!==geoKey(part))]){
   parents=(await db.prepare('SELECT state,admin2 FROM network_geo_parent_names WHERE country=? AND alias=? LIMIT 64').bind(country,alias).all<Parent>()).results;
   if(parents.length)break;
  }
  if(!parents.length||parents.length>=64){unresolvedParent=true;continue;}
  allowedStates=intersect(allowedStates,new Set(parents.map(p=>p.state)));
  allowedParents=intersect(allowedParents,new Set(parents.map(p=>p.admin2)));
 }
 if(parts.length===1){
  const matches=stateMatches(cityText);
  if(matches.length){
   const primary=(await db.prepare('SELECT DISTINCT c.id,c.state FROM network_geo_primary_names a JOIN network_geo_cities c ON c.id=a.city WHERE a.country=? AND a.alias=? LIMIT 2').bind(country,geoKey(cityText)).all<City>()).results;
   if(primary.length===1&&!matches.some(s=>geoKey(s.name)===geoKey(cityText))&&states.some(s=>s.id===primary[0].state))return {state:primary[0].state,city:primary[0].id};
   allowedStates=new Set(matches.map(s=>s.id));stateOnly=true;
  }
  else{
   const suffixes=states.flatMap(s=>(JSON.parse(s.aliases) as string[]).filter(a=>a.length>=2).map(alias=>({s,alias})))
    .filter(({alias})=>geoKey(cityText).endsWith(' '+alias)).sort((a,b)=>b.alias.length-a.alias.length);
   if(suffixes.length&&suffixes.filter(s=>s.alias===suffixes[0].alias).length===1){allowedStates=new Set([suffixes[0].s.id]);cityText=geoKey(cityText).slice(0,-suffixes[0].alias.length).trim();}
  }
 }
 if(allowedStates?.size===0||allowedParents?.size===0)return empty;
 const state=allowedStates?.size===1?[...allowedStates][0]:null;
 if(unresolvedParent&&!state)return {state,city:null};
 async function cities(table:'network_geo_primary_names'|'network_geo_aliases'){
  const values:string[]=[country!,geoKey(cityText)];let condition='';
  if(allowedStates){condition+=` AND c.state IN (${[...allowedStates].map(()=>'?').join(',')})`;values.push(...allowedStates);}
  if(allowedParents){condition+=` AND ca.admin2 IN (${[...allowedParents].map(()=>'?').join(',')})`;values.push(...allowedParents);}
  return (await db.prepare(`SELECT DISTINCT c.id,c.state FROM ${table} a JOIN network_geo_cities c ON c.id=a.city LEFT JOIN network_geo_city_admin ca ON ca.city=c.id WHERE a.country=? AND a.alias=? ${condition} LIMIT 2`).bind(...values).all<City>()).results;
 }
 let candidates=await cities('network_geo_primary_names');
 if(!candidates.length&&!stateOnly)candidates=await cities('network_geo_aliases');
 if(candidates.length===1&&states.some(s=>s.id===candidates[0].state))return {state:candidates[0].state,city:candidates[0].id};
 return {state,city:null};
}

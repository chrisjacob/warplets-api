import { stripNetworkPostal } from './postal';
import type { NetworkVote } from './model';
const ISO = new Set('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' '));
const countryKey=(value:string)=>value.normalize('NFKD').replace(/\p{M}/gu,'').replace(/\./g,'').replace(/’/g,"'").toLowerCase().replace(/\s+/g,' ').trim();
const names = new Map<string,string>();
for(const style of ['long','short'] as const){const display=new Intl.DisplayNames(['en'],{type:'region',style});for(const code of ISO)names.set(countryKey(display.of(code)!),code);}
for(const [name,code] of [['usa','US'],['United States of America','US'],['uk','GB'],['uae','AE'],['south korea','KR'],['north korea','KP']])names.set(countryKey(name),code);
const countrySuffixes=[...names].filter(([name])=>name.length>=4).sort((a,b)=>b[0].length-a[0].length);
const stateCountryCollisions=new Set('CA CO DE GA ID IL IN MA MD ME MN MO MS MT NC NE PA PR SC SD TN VA VI'.split(' '));
export function networkLocationParts(description:unknown):{country:string|null;parts:string[]}{
 const empty={country:null,parts:[]};
 if(typeof description!=='string'||description.length>500)return empty;
 const text=description.normalize('NFKC').replace(/\s+/g,' ').trim();
 if(!text)return empty;
 const parts=text.split(/[,，]/).map(p=>p.trim()).filter(Boolean);
 const exact=(part:string,code=true)=>names.get(countryKey(part))??(code&&ISO.has(part)?part:null);
 let index=parts.length-1,country=exact(parts[index]);
 if(country&&parts.length>1&&stateCountryCollisions.has(parts[index]))return empty;
 // Some clients place the country before a postcode or other address components.
 if(!country){const candidates=parts.map((part,i)=>({country:exact(part,false),i})).filter(p=>p.country&&p.i>0);if(candidates.length===1){country=candidates[0].country;index=candidates[0].i;}}
 if(country){
  const rest=parts.filter((_,i)=>i!==index).map(p=>stripNetworkPostal(p,country!)).filter(Boolean);
  return {country,parts:rest};
 }
 // Match an explicit country-name suffix; never infer a country from the city.
 const normalized=countryKey(text);
 for(const [name,code] of countrySuffixes){
  if(name.length<4||!normalized.endsWith(' '+name))continue;
  const rawPrefix=normalized.slice(0,-name.length);
  if(!name.includes(' ')&&!/[,–—-]\s*$/.test(rawPrefix))continue;
  const prefix=rawPrefix.replace(/[\s,–—-]+$/,'');
  if(!prefix)continue;
  return {country:code,parts:prefix.split(/,|\s+[-–—]\s+/).map(p=>stripNetworkPostal(p,code)).filter(Boolean)};
 }
 return empty;
}
export function networkCountry(description:unknown):string|null{return networkLocationParts(description).country;}
export function networkAsset(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 180) return null;
  const evm = value.match(/^eip155:([1-9]\d*)\/erc20:(0x[a-fA-F0-9]{40})$/);
  if (evm) return `eip155:${evm[1]}/erc20:${evm[2].toLowerCase()}`;
  if (/^solana:[1-9A-HJ-NP-Za-km-z]{1,64}\/token:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return value;
  if (/^(eip155:[1-9]\d*|solana:[1-9A-HJ-NP-Za-km-z]{1,64})\/slip44:\d+$/.test(value)) return value;
  return null;
}
export interface NetworkIdentity { username: string | null; displayName: string | null; avatarUrl: string | null }
export function networkIdentity(username: unknown, displayName: unknown, avatar: unknown): NetworkIdentity {
  let avatarUrl: string | null = null;
  if (typeof avatar === 'string' && avatar.length <= 2048) {
    try { const url = new URL(avatar); if (url.protocol === 'https:' && !url.username && !url.password) avatarUrl = url.href; } catch { /* Missing or malformed image uses initials. */ }
  }
  return { username: typeof username === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(username) ? username : null,
    displayName: typeof displayName === 'string' ? displayName.trim().slice(0, 100) || null : null, avatarUrl };
}
export interface NetworkProfile extends NetworkIdentity { fid: number; publicLocation?: string; placeId?: string | null; country: string | null; locationStatus: 'known' | 'unknown'; token: string | null; tokenStatus: 'assigned' | 'none' | 'unavailable'; tokenName: string | null; tokenSymbol: string | null; vote: NetworkVote; observedAt: number }
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export function normalizeNetworkProfile(payload: unknown, fid: number, observedAt: number): NetworkProfile {
  const user = object(object(object(payload).result).user), profile = object(user.profile);
  if (user.fid !== fid || !Object.hasOwn(user, 'profile')) throw new Error('Profile identity mismatch');
  const country = networkCountry(object(profile.location).description);
  const tokenField = object(profile.profileToken), token = networkAsset(tokenField.tokenUri), metadata = object(tokenField.token);
  const status = object(user.viewerContext).optInStatus;
  return { ...networkIdentity(user.username, user.displayName, object(user.pfp).url), fid, publicLocation: typeof object(profile.location).description === 'string' ? String(object(profile.location).description).slice(0,500) : '', placeId: typeof object(profile.location).placeId === 'string' ? String(object(profile.location).placeId).slice(0,250) : null, country, locationStatus: country ? 'known' : 'unknown', token,
    tokenStatus: token ? 'assigned' : tokenField.tokenUri === '' ? 'none' : 'unavailable',
    tokenName: typeof metadata.name === 'string' ? metadata.name.slice(0, 100) : null,
    tokenSymbol: typeof metadata.symbol === 'string' ? metadata.symbol.slice(0, 24) : null,
    vote: ['opted_in', 'opted_out', 'pending', 'moderated_out'].includes(String(status)) ? status as NetworkVote : 'unavailable', observedAt };
}

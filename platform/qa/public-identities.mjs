import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync,statSync} from 'node:fs';
import {resolve,join,dirname,basename} from 'node:path';
export const IDENTITY_FORMAT='10x.qa.public-identities.v1';
export const IDENTITY_NOTICE='Public names and artwork in a simulated demo. Activity, wallets, prices and rewards are synthetic; no affiliation or endorsement.';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(ok,message)=>{if(!ok)throw Error(message);};
const imageHosts=new Set(['imagedelivery.net','wrpcd.net','i.imgur.com','i.seadn.io','cdn.dexscreener.com','coin-images.coingecko.com','assets.coingecko.com','assets.geckoterminal.com']);
const clean=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value)?value:null;
export function safePublicImageUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&imageHosts.has(u.hostname)&&u.href.length<=2048?u.href:null;}catch{return null;}}
function sourceUrl(value){const u=new URL(value);need(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['client.farcaster.xyz','api.geckoterminal.com'].includes(u.hostname),'Unsupported public source.');return u.href;}
async function boundedResponse(response,max){
 need(response.ok,'Public source HTTP '+response.status);const length=response.headers.get('content-length');need(!length||Number(length)<=max,'Public response exceeds byte limit.');
 const reader=response.body?.getReader();need(reader,'Public response body missing.');const chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;need(size<=max,'Public response exceeds byte limit.');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
 return Buffer.concat(chunks);
}
function imageType(bytes,type){
 const mime=type?.split(';')[0]?.toLowerCase();let width=0,height=0,extension;
 if(mime==='image/png'&&bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR'){width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);extension='png';}
 else if(mime==='image/gif'&&bytes.length>=10&&['GIF87a','GIF89a'].includes(bytes.toString('ascii',0,6))){width=bytes.readUInt16LE(6);height=bytes.readUInt16LE(8);extension='gif';}
 else if(mime==='image/jpeg'&&bytes[0]===255&&bytes[1]===216){
  for(let offset=2;offset+3<bytes.length;){if(bytes[offset++]!==255)break;while(bytes[offset]===255)offset++;const marker=bytes[offset++];if(marker===217||marker===218)break;if(marker===1||marker>=208&&marker<=215)continue;if(offset+2>bytes.length)break;const length=bytes.readUInt16BE(offset);if(length<2||offset+length>bytes.length)break;
   if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){if(length<8)break;height=bytes.readUInt16BE(offset+3);width=bytes.readUInt16BE(offset+5);extension='jpg';break;}offset+=length;
  }
 }else if(mime==='image/webp'&&bytes.length>=25&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'&&bytes.readUInt32LE(4)+8===bytes.length){
  const chunk=bytes.toString('ascii',12,16),size=bytes.readUInt32LE(16);if(size+20<=bytes.length){
   if(chunk==='VP8X'&&size>=10){width=bytes.readUIntLE(24,3)+1;height=bytes.readUIntLE(27,3)+1;extension='webp';}
   else if(chunk==='VP8L'&&size>=5&&bytes[20]===47){const bits=bytes.readUInt32LE(21);width=(bits&16383)+1;height=((bits>>>14)&16383)+1;extension='webp';}
   else if(chunk==='VP8 '&&size>=10&&bytes[23]===157&&bytes[24]===1&&bytes[25]===42){width=bytes.readUInt16LE(26)&16383;height=bytes.readUInt16LE(28)&16383;extension='webp';}
  }
 }
 need(extension,'Unsupported or mismatched image format.');need(width>0&&height>0&&width<=2048&&height<=2048,'Image dimensions exceed limit.');return {mime,extension};
}
export function readQaIdentitySource(directory){
 const root=resolve(directory);need(!existsSync(join(root,'FAILED.txt')),'QA scenario is incomplete.');
 need(statSync(join(root,'scenario.json')).size<=131072&&statSync(join(root,'performance.json')).size<=10*1024*1024,'QA source exceeds bound.');
 const report=JSON.parse(readFileSync(join(root,'scenario.json'),'utf8')),bytes=readFileSync(join(root,'performance.json'));
 need(report.scope==='synthetic-local-only'&&report.status==='complete'&&digest(bytes)===report.performance.sha256,'QA source digest or scope differs.');
 const snapshot=JSON.parse(bytes);need(snapshot.mode==='synthetic-local'&&snapshot.tokens.length<=1000&&snapshot.participants.length<=1000,'Invalid QA identity source.');return {report,snapshot};
}
/** Explicit local refresh. Persist only public display fields, never source bios,
 * connected accounts, real wallets, holdings or prices. No runtime network proxy.
 */
export async function importPublicIdentities({directory,output,fetcher=fetch,nowMs=Date.now(),onProgress=()=>{}}){
 const {report,snapshot}=readQaIdentitySource(directory),target=resolve(output??'');need(output&&basename(target).startsWith('qa-'),'Use a new output directory with a qa- prefix.');need(!existsSync(target),'Refusing to overwrite an identity snapshot.');
 mkdirSync(dirname(target),{recursive:true});mkdirSync(target);mkdirSync(join(target,'images'));
 const sources=[],failures=[],people=[],tokens=[],seenPeople=new Set(),seenTokens=new Set();
 async function json(url){sourceUrl(url);const response=await fetcher(url,{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(15000),headers:{accept:'application/json'}}),bytes=await boundedResponse(response,1048576),id='source-'+sources.length;sources.push({id,url,sha256:digest(bytes),bytes:bytes.length});return {id,value:JSON.parse(bytes.toString('utf8'))};}
 const failure=(kind,url)=>failures.push({kind,url,reason:'Public source unavailable or outside validated limits.'});
 try{
  const wantedProfiles=snapshot.participants.filter(p=>p.wallet!==report.wallet).length,candidateLimit=Math.min(wantedProfiles+150,600);
  for(const fid of [3,2]){let cursor=null;for(let page=0;page<6&&people.length<candidateLimit;page++){
   const url='https://client.farcaster.xyz/v2/following?fid='+fid+'&limit=50'+(cursor?'&cursor='+encodeURIComponent(cursor):'');let result;try{result=await json(url);}catch{failure('profiles',url);break;}
   const users=result.value.result?.users;if(!Array.isArray(users)||users.length>50){failure('profiles',url);break;}
   for(const u of users){if(people.length>=candidateLimit)break;if(!Number.isSafeInteger(u.fid)||u.fid<1||seenPeople.has(u.fid)||!clean(u.username,64)||!/^[a-zA-Z0-9._-]+$/.test(u.username))continue;
    seenPeople.add(u.fid);people.push({fid:u.fid,username:u.username,displayName:clean(u.displayName,160)??u.username,profileUrl:'https://farcaster.xyz/'+encodeURIComponent(u.username),sourceImage:safePublicImageUrl(u.pfp?.url),sourceId:result.id});}
   const next=result.value.next?.cursor;if(typeof next!=='string'||!next||next.length>2048||next===cursor)break;cursor=next;
  }}onProgress({phase:'profiles',count:people.length});
  for(let page=1;page<=8&&tokens.length<snapshot.tokens.length;page++){
   const url='https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?include=base_token&duration=24h&page='+page;let result;try{result=await json(url);}catch{failure('tokens',url);break;}
   const {data,included}=result.value;if(!Array.isArray(data)||data.length>100||!Array.isArray(included)||included.length>200){failure('tokens',url);break;}if(!data.length)break;
   const byId=new Map(included.filter(t=>t.type==='token').map(t=>[t.id,t.attributes]));
   for(const pool of data){if(tokens.length>=snapshot.tokens.length)break;const a=byId.get(pool.relationships?.base_token?.data?.id);if(!a||!clean(a.name,160)||!clean(a.symbol,40)||!/^\w{32,44}$/.test(a.address)||seenTokens.has(a.address)||!/^\w{32,44}$/.test(pool.attributes?.address??''))continue;
    seenTokens.add(a.address);tokens.push({name:a.name,symbol:a.symbol,address:a.address,sourceUrl:'https://www.geckoterminal.com/solana/pools/'+pool.attributes.address,sourceImage:safePublicImageUrl(a.image_url),sourceId:result.id});}
  }onProgress({phase:'tokens',count:tokens.length});need(people.length||tokens.length,'No verified public identities were available.');
  const images=[],imageCache=new Map(),imageBytes=new Map(),imageFailures={};let storedBytes=0,finishedImages=0;
  const imageFailure=reason=>{imageFailures[reason]=(imageFailures[reason]??0)+1;return null;};
  async function cacheImage(url){if(!url)return imageFailure('missing-or-untrusted-url');if(imageCache.has(url))return imageCache.get(url);const pending=(async()=>{try{
   if(storedBytes>=33554432)return imageFailure('total-cache-bound');const response=await fetcher(url,{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(12000),headers:{accept:'image/png,image/jpeg,image/webp,image/gif'}}),bytes=await boundedResponse(response,262144),type=imageType(bytes,response.headers.get('content-type'));if(storedBytes+bytes.length>33554432)return imageFailure('total-cache-bound');
   const sha256=digest(bytes),path='/qa-media/'+sha256+'.'+type.extension;if(!images.some(image=>image.path===path)){imageBytes.set(path,bytes);images.push({path,sourceUrl:url,sha256,bytes:bytes.length,mime:type.mime});storedBytes+=bytes.length;}return path;
  }catch(error){return imageFailure(/^Public source HTTP \d{3}$/.test(error.message)?error.message: error.message==='Public response exceeds byte limit.'?'image-byte-bound':error.message==='Image dimensions exceed limit.'?'image-dimension-bound':error.message==='Unsupported or mismatched image format.'?'unsupported-raster':error.name==='TimeoutError'?'timeout':'fetch-failed');}finally{finishedImages++;if(finishedImages%40===0)onProgress({phase:'images',processed:finishedImages,cached:images.length});}})();imageCache.set(url,pending);return pending;}
  const entries=[...people,...tokens];let position=0;await Promise.all(Array.from({length:4},async()=>{for(;;){const item=entries[position++];if(!item)break;item.image=await cacheImage(item.sourceImage);delete item.sourceImage;}}));
  const selectedPeople=[...people.filter(p=>p.image),...people.filter(p=>!p.image)].slice(0,wantedProfiles),selectedEntries=[...selectedPeople,...tokens],usedImages=new Set(selectedEntries.map(e=>e.image).filter(Boolean)),selectedImages=images.filter(image=>usedImages.has(image.path));
  for(const image of selectedImages)writeFileSync(join(target,'images',basename(image.path)),imageBytes.get(image.path),{flag:'wx'});
  const wallets=snapshot.participants.filter(p=>p.wallet!==report.wallet).map(p=>p.wallet),orderedTokens=[...snapshot.tokens].sort((a,b)=>Date.parse(b.launchAt)-Date.parse(a.launchAt));
  const manifest={format:IDENTITY_FORMAT,scope:'synthetic-presentation-only',capturedAt:new Date(nowMs).toISOString(),sourcePerformanceSha256:report.performance.sha256,ownerWallet:report.wallet,notice:IDENTITY_NOTICE,profiles:selectedPeople.map((p,i)=>({...p,wallet:wallets[i]})),tokens:tokens.map((t,i)=>({...t,tokenId:orderedTokens[i].id,originalSymbol:orderedTokens[i].symbol})),sources,images:selectedImages,failures,imageAttempts:{candidateProfiles:people.length,requested:finishedImages,failuresByReason:imageFailures},coverage:{participants:snapshot.participants.length,profiles:selectedPeople.length,ownerPreserved:1,profileFallbacks:wallets.length-selectedPeople.length,tokens:snapshot.tokens.length,tokenNames:tokens.length,tokenFallbacks:snapshot.tokens.length-tokens.length,cachedImages:selectedEntries.filter(e=>e.image).length,imageFallbacks:selectedEntries.filter(e=>!e.image).length,cacheBytes:selectedImages.reduce((n,image)=>n+image.bytes,0)},financialExecution:false};
  const bytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');need(bytes.length<=524288,'Identity manifest exceeds bound.');writeFileSync(join(target,'identities.json'),bytes,{flag:'wx'});writeFileSync(join(target,'identities.sha256'),digest(bytes)+'\n',{flag:'wx'});return manifest;
 }catch(error){writeFileSync(join(target,'FAILED.txt'),'Incomplete public QA identity import. No economic data changed.\n');throw error;}
}

/** Validate/pin local images once at startup. Serving never fetches source URLs. */
export function loadPublicIdentities(path,{snapshot,report}){
 const file=resolve(path),root=dirname(file);need(!existsSync(join(root,'FAILED.txt')),'Identity import is incomplete.');need(statSync(file).size<=524288,'Identity manifest exceeds bound.');const bytes=readFileSync(file);need(digest(bytes)===readFileSync(join(root,'identities.sha256'),'utf8').trim(),'Identity manifest digest differs.');
 const value=JSON.parse(bytes);need(value.format===IDENTITY_FORMAT&&value.scope==='synthetic-presentation-only'&&value.financialExecution===false&&value.notice===IDENTITY_NOTICE&&value.sourcePerformanceSha256===report.performance.sha256&&value.ownerWallet===report.wallet,'Identity overlay does not match this synthetic snapshot.');
 need(new Date(value.capturedAt).toISOString()===value.capturedAt&&Array.isArray(value.profiles)&&value.profiles.length<=1000&&Array.isArray(value.tokens)&&value.tokens.length<=1000&&Array.isArray(value.images)&&value.images.length<=2000&&Array.isArray(value.sources)&&value.sources.length<=20,'Invalid identity manifest bounds.');
 const sources=new Set();for(const s of value.sources){sourceUrl(s.url);need(typeof s.id==='string'&&!sources.has(s.id)&&/^[a-f0-9]{64}$/.test(s.sha256)&&Number.isInteger(s.bytes)&&s.bytes<=1048576,'Invalid source receipt.');sources.add(s.id);}
 const media=new Map();let total=0;for(const img of value.images){need(/^\/qa-media\/[a-f0-9]{64}\.(png|jpg|webp|gif)$/.test(img.path)&&!media.has(img.path)&&safePublicImageUrl(img.sourceUrl)&&Number.isInteger(img.bytes)&&img.bytes>0&&img.bytes<=262144,'Invalid cached image.');const file=join(root,'images',basename(img.path));need(statSync(file).size===img.bytes,'Cached image size differs.');const data=readFileSync(file),type=imageType(data,img.mime);need(digest(data)===img.sha256&&img.path==='/qa-media/'+img.sha256+'.'+type.extension,'Cached image digest differs.');total+=data.length;need(total<=33554432,'Image cache exceeds bound.');media.set(img.path,{bytes:data,mime:type.mime});}
 const wallets=new Set(snapshot.participants.map(p=>p.wallet)),tokenIds=new Map(snapshot.tokens.map(t=>[t.id,t.symbol])),seenWallets=new Set(),seenFids=new Set(),seenIds=new Set(),seenAddresses=new Set();
 for(const p of value.profiles){need(wallets.has(p.wallet)&&p.wallet!==report.wallet&&!seenWallets.has(p.wallet)&&Number.isSafeInteger(p.fid)&&p.fid>0&&!seenFids.has(p.fid)&&clean(p.username,64)&&/^[a-zA-Z0-9._-]+$/.test(p.username)&&clean(p.displayName,160)&&p.profileUrl==='https://farcaster.xyz/'+encodeURIComponent(p.username)&&sources.has(p.sourceId)&&(p.image===null||media.has(p.image)),'Invalid public profile association.');seenWallets.add(p.wallet);seenFids.add(p.fid);}
 for(const t of value.tokens){need(tokenIds.get(t.tokenId)===t.originalSymbol&&!seenIds.has(t.tokenId)&&!seenAddresses.has(t.address)&&/^\w{32,44}$/.test(t.address)&&clean(t.name,160)&&clean(t.symbol,40)&&/^https:\/\/www\.geckoterminal\.com\/solana\/pools\/\w{32,44}$/.test(t.sourceUrl)&&sources.has(t.sourceId)&&(t.image===null||media.has(t.image)),'Invalid public token association.');seenIds.add(t.tokenId);seenAddresses.add(t.address);}
 return {value:{format:value.format,scope:value.scope,capturedAt:value.capturedAt,notice:value.notice,profiles:value.profiles.map(({wallet,username,displayName,profileUrl,image})=>({wallet,username,displayName,profileUrl,image})),tokens:value.tokens.map(({tokenId,originalSymbol,name,symbol,sourceUrl,image})=>({tokenId,originalSymbol,name,symbol,sourceUrl,image})),coverage:value.coverage},media};
}
export function publicIdentityResponse(request,overlay){
 const url=new URL(request.url);if(url.pathname!=='/api/v1/qa/identities'&&!url.pathname.startsWith('/qa-media/'))return null;const headers={'x-content-type-options':'nosniff','cache-control':'no-store'};
 if(!overlay)return new Response('Not found',{status:404,headers});if(!['GET','HEAD'].includes(request.method))return new Response('Read only',{status:405,headers:{...headers,allow:'GET, HEAD'}});if(url.search)return new Response('Not found',{status:404,headers});
 if(url.pathname==='/api/v1/qa/identities')return new Response(request.method==='HEAD'?null:JSON.stringify(overlay.value),{headers:{...headers,'content-type':'application/json; charset=utf-8'}});
 const image=overlay.media.get(url.pathname);if(!image)return new Response('Not found',{status:404,headers});return new Response(request.method==='HEAD'?null:image.bytes,{headers:{...headers,'content-type':image.mime,'content-length':String(image.bytes.length),'cache-control':'public, max-age=31536000, immutable'}});
}

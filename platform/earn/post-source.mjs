import {supportedPost} from './supported-post.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
const need=(ok)=>{if(!ok)throw Error('Public post response was unavailable or could not be verified.');};
const text=(v,max)=>typeof v==='string'&&v.length<=max&&!/[\u0000\u000b\u000c]/.test(v);
const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',mdash:'—',ndash:'–',hellip:'…'};
function plainExcerpt(html){
 need(text(html,32768));const match=/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/i.exec(html);need(match);
 need(!/<\s*\/?\s*(?!a(?:\s|>|\/)|br(?:\s|>|\/))[a-z]/i.test(match[1]));
 const plain=match[1].replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi,(whole,name)=>{
  if(name[0]!=='#')return entities[name.toLowerCase()]??whole;const n=name[1].toLowerCase()==='x'?parseInt(name.slice(2),16):Number(name.slice(1));return Number.isInteger(n)&&n>0&&n<=1114111&&!(n>=55296&&n<=57343)?String.fromCodePoint(n):'';
 }).trim();need(plain.length>0&&plain.length<=20000);return plain;
}
async function responseBytes(response){
 need(response.ok&&response.headers.get('content-type')?.includes('application/json'));const length=response.headers.get('content-length');need(!length||Number(length)<=262144);const reader=response.body?.getReader();need(reader);const parts=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;need(size<=262144);parts.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const result=new Uint8Array(size);let offset=0;for(const part of parts){result.set(part,offset);offset+=part.length;}return result;
}
const buckets=['images','urls','videos','casts','unknowns'];
const emptyObject=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.values(value).every(v=>Array.isArray(v)&&v.length===0);
const noAttachments=value=>emptyObject(value)&&buckets.every(key=>Array.isArray(value[key]));
async function readJson(endpoint,{fetcher,crypto,clock}){
 const response=await fetcher(endpoint,{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(8000),headers:{accept:'application/json'}}),bytes=await responseBytes(response);
 return {data:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),receipt:{endpoint,sha256:await crypto.sha256(bytes),bytes:bytes.length,observedAt:new Date(clock.nowMs()).toISOString()}};
}
/** Public reads use fixed source endpoints, never the submitted URL or redirects.
 * Source content is untrusted text. Returned HTML, media URLs and link metadata
 * are never executed/fetched, nor is a matching post proof of wallet authorship.
 */
export async function readSupportedPost(url,{fetcher=fetch,crypto,clock={nowMs:Date.now},requireCompleteText=false}){
 const post=supportedPost(url),at=new Date(clock.nowMs()).toISOString();
 const endpoint=post.source==='farcaster'?'https://client.farcaster.xyz/v2/thread-casts?castHash='+post.id:'https://publish.x.com/oembed?url='+encodeURIComponent(post.canonicalUrl)+'&omit_script=true&dnt=true';
 const {data,receipt}=await readJson(endpoint,{fetcher,crypto,clock});
 if(post.source==='farcaster'){
  need(data.result?.disallowed!==true&&Array.isArray(data.result?.casts)&&data.result.casts.length<=100);
  const matches=data.result.casts.filter(c=>typeof c.hash==='string'&&/^0x[a-f0-9]{40}$/.test(c.hash)&&c.hash.startsWith(post.id)&&c.author?.username?.toLowerCase()===post.username);need(matches.length===1);
  const cast=matches[0];need(text(cast.text,20000)&&cast.text.trim().length>0&&Number.isSafeInteger(cast.author.fid)&&cast.author.fid>0&&Number.isSafeInteger(cast.timestamp)&&cast.timestamp>0&&cast.timestamp<=clock.nowMs()+30000&&!cast.deleted&&!cast.isDeleted);
  // Unknown/missing attachment shapes require manual review too. Link cards can
  // contain material context; never silently call that a complete text capture.
  const embeds=cast.embeds;let hasMedia=!noAttachments(embeds);
  if(requireCompleteText&&hasMedia&&(embeds==null||emptyObject(embeds))){
   // The thread endpoint omits attachment metadata for some text-only casts.
   // One bounded recent-cast read can establish explicit emptiness. Never page,
   // infer completeness from missing fields, or override a nonempty attachment.
   const supplement=await readJson('https://client.farcaster.xyz/v2/casts?fid='+cast.author.fid+'&limit=20',{fetcher,crypto,clock});
   need(supplement.data.result?.disallowed!==true&&Array.isArray(supplement.data.result?.casts)&&supplement.data.result.casts.length<=20);
   const exact=supplement.data.result.casts.filter(c=>c.hash===cast.hash&&c.author?.username===cast.author.username&&c.author?.fid===cast.author.fid&&c.text===cast.text&&c.timestamp===cast.timestamp&&!c.deleted&&!c.isDeleted);need(exact.length===1&&noAttachments(exact[0].embeds));
   receipt.attachmentEvidence={...supplement.receipt,postId:cast.hash};hasMedia=false;
  }
  return {...post,text:cast.text.trim(),author:cleanAuthor(cast.author.displayName,cast.author.username),capturedAt:at,provenance:'farcaster-public-api',textComplete:true,hasMedia,receipt:{...receipt,postId:cast.hash},message:hasMedia?'Post text loaded. Open the original for full context and any attached media.':'Public post text loaded. Authorship and reward eligibility are reviewed separately.'};
 }
 need(['Twitter','X'].includes(data.provider_name)&&['https://twitter.com','https://x.com'].includes(data.provider_url?.replace(/\/$/,''))&&data.type==='rich');
 const returned=supportedPost(data.url);need(returned.source==='x'&&returned.id===post.id);
 return {...post,text:plainExcerpt(data.html),author:text(data.author_name,160)?data.author_name:null,capturedAt:at,provenance:'x-oembed',textComplete:false,hasMedia:true,receipt:{...receipt,postId:post.id},message:'X provides a public excerpt. Open the original for the complete post and media. Full-source capture is still required before scoring.'};
}
function cleanAuthor(name,username){return text(name,160)&&name.trim()?name.trim()+' (@'+username+')':'@'+username;}
export async function createPostCapture({submission,projectContext,source,crypto,nowMs=Date.now()}){
 const post=supportedPost(submission.url);need(source.source===post.source&&source.id===post.id&&source.canonicalUrl===post.canonicalUrl&&source.textComplete&&!source.hasMedia&&source.source==='farcaster');
 need(text(projectContext,8000)&&projectContext.trim().length>0&&Date.parse(source.capturedAt)>=submission.submitted_ms&&Date.parse(source.capturedAt)<=nowMs);
 const receipt={...source.receipt,source:source.source,canonicalUrl:source.canonicalUrl,textOnly:true,mediaIncluded:false,automaticScoringEnabled:false},sourceReceiptHash=await crypto.sha256(utf8(canonicalJson(receipt)));
 return {job:{submissionId:submission.id,tokenId:submission.token_id,url:submission.url,capturedAt:source.capturedAt,contentType:'text',content:source.text,projectContext:projectContext.trim()},evidenceRef:'public-post-v1:'+source.source+':'+sourceReceiptHash,receipt:{...receipt,sourceReceiptHash}};
}

import { newsHistoryCutoff } from '../../shared/stonkletsNewsDates';
import { canonicalNewsUrl } from '../../shared/stonkletsNews';
export interface ArchiveArticle {url:string;headline:string;publishedAt:string;evidence:string;evidenceKind:'article-body'|'description';status:'needs-review'}
const clean=(s:string)=>s.replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
export function archiveLinks(html:string,base:string):string[]{
 const origin=new URL(base).origin;const urls:string[]=[];
 for(const m of html.matchAll(/(?:href\s*=\s*["']([^"']+)["']|<loc>\s*([^<]+)\s*<\/loc>)/gi))try{const u=new URL(clean(m[1]??m[2]!),base);if(u.origin!==origin||u.username||u.password||/\.(?:pdf|png|jpg|svg|zip|css|js)(?:$|\?)/i.test(u.href))continue;urls.push(canonicalNewsUrl(u.href));}catch{}
 return [...new Set(urls)];
}
export function parseArchiveArticle(html:string,url:string,now:number):ArchiveArticle|null {
 const objects:any[]=[];
 function visit(value:any,depth=0){if(depth>8||!value||typeof value!=='object')return;if(Array.isArray(value)){value.slice(0,100).forEach(v=>visit(v,depth+1));return;}objects.push(value);if(value['@graph'])visit(value['@graph'],depth+1);}
 for(const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))try{visit(JSON.parse(m[1]!));}catch{}
 for(const data of objects){const types=Array.isArray(data['@type'])?data['@type']:[data['@type']];if(!types.some((t:string)=>['Article','NewsArticle','BlogPosting','ReportageNewsArticle'].includes(t)))continue;
 const title=clean(String(data.headline??'')),date=Date.parse(data.datePublished??'');
 if(!title||title.length>500||!Number.isFinite(date)||date<newsHistoryCutoff(now)||date>now)continue;
 const canonical=typeof data.url==='string'?data.url:url;let safe:string;try{safe=canonicalNewsUrl(new URL(canonical,url).href);if(new URL(safe).origin!==new URL(url).origin)continue;}catch{continue;}
 const articleHtml=html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
 const body=typeof data.articleBody==='string'?clean(data.articleBody):articleHtml?clean(articleHtml.replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi,'')):'';const description=typeof data.description==='string'?clean(data.description):'';
 return {url:safe,headline:title,publishedAt:new Date(date).toISOString(),evidence:(body||description).slice(0,12000),evidenceKind:body?'article-body':'description',status:'needs-review'};
 }
 return null;
}

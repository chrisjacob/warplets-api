import {readFileSync,writeFileSync} from 'node:fs';
import {STONKLETS_CATALOG} from '../app/shared/stonkletsCatalog';
import {newsSource,selectNews,type NewsItem} from '../app/shared/stonkletsNews';
import {newsHistoryCutoff} from '../app/shared/stonkletsNewsDates';
import {NEWS_FEEDS,NEWS_IDENTITIES} from '../app/functions/_lib/stonkletNewsResearch';
const now=Date.parse(process.argv[2] ?? new Date().toISOString());
if(!Number.isFinite(now))throw new Error('Expected ISO audit timestamp');
const manifest=JSON.parse(readFileSync('app/shared/stonkletsNarrativeBackfill.json','utf8'));
const reviewed=manifest.entries as NewsItem[];
const wires=new Set(['businesswire.com','prnewswire.com','globenewswire.com','quotemedia.com']);
const press=new Set(['reuters.com','cnbc.com','bbc.com','bbc.co.uk','apnews.com','axios.com','electrek.co','ess-news.com','space.com','utilitydive.com','energy-storage.news','etf.com','pv-magazine.de','techcrunch.com']);
const primary=new Set(['nasa.gov','rdw.nl','sec.gov','gold.org','semiconductors.org','motir.go.kr','esyasoft.com','global.fujitsu']);
const company=new Set(['ssga.com','alibabacloud.com','blog.google','amd.com','apple.com','appliedmaterials.com','asml.com','asteralabs.com','bloomenergy.com','circle.com','coherent.com','credosemi.com','dell.com','fluenceenergy.com','intel.com','invesco.com','gcs-web.com','lumentum.com','fb.com','micron.com','microsoft.com','netflix.com','nvidia.com','paypal-corp.com','robinhood.com','sandisk.com','skhynix.com','strategy.com','supermicro.com','tether.io','usare.com']);
function origin(i:NewsItem){const s=newsSource(i)!;const d=i.sourceDomain;const evidence=[s.publisher,s.excerpt,i.evidence,JSON.stringify((i as any).provenance)].join(' ');
 if(wires.has(d)||company.has(d))return {kind:'issuer',owner:i.pairId};
 if(primary.has(d))return {kind:'primary',owner:d};
 if(press.has(d))return {kind:'independent',owner:d};
 if(/\bReuters\b/i.test(evidence))return {kind:'independent',owner:'reuters.com'};
 return {kind:'unverified',owner:d};
}
const months:string[]=[];let t=new Date(newsHistoryCutoff(now));t.setUTCDate(1);while(t.getTime()<=now){months.push(t.toISOString().slice(0,7));t.setUTCMonth(t.getUTCMonth()+1);}
const rows=STONKLETS_CATALOG.map(p=>{
 const candidates=reviewed.filter(i=>i.pairId===p.id&&selectNews([i],p.id,now).length);
 const unique=new Map<string,NewsItem>();for(const i of candidates){const old=unique.get(i.narrativeKey);if(!old||i.sourcePriority<old.sourcePriority)unique.set(i.narrativeKey,i);}
 const items=[...unique.values()];const counts=Object.fromEntries(months.map(m=>[m,items.filter(i=>newsSource(i)!.publishedAt.startsWith(m)).length]));
 const sources=candidates.map(i=>({id:i.id,url:newsSource(i)!.url,date:newsSource(i)!.publishedAt,...origin(i)}));
 const independent=[...new Set(sources.filter(s=>s.kind==='independent').map(s=>s.owner))];const primaryOwners=[...new Set(sources.filter(s=>s.kind==='issuer'||s.kind==='primary').map(s=>s.owner))];
 const feeds=NEWS_FEEDS.filter(f=>f.enabled&&f.pairIds.includes(p.id));
 return {pairId:p.id,name:p.stock.name,stories:items.length,months:counts,missingMonths:months.filter(m=>!counts[m]),volumePass:items.length>=10||months.every(m=>counts[m]>0),sourceDiversityPass:primaryOwners.length>0&&independent.length>0,primaryOwners,independentOwners:independent,unverifiedDomains:[...new Set(sources.filter(s=>s.kind==='unverified').map(s=>s.owner))],officialDiscoveryHomepage:NEWS_IDENTITIES.find(i=>i.pairId===p.id)?.homepage,officialAutomatedFeed:feeds.some(f=>f.priority===0),discoveryFeeds:feeds.map(f=>f.id),sources};
});
const report={checkedAt:new Date(now).toISOString(),windowStart:new Date(newsHistoryCutoff(now)).toISOString(),method:'Reviewed manifest only; uncapped distinct narratives. Discovery feeds are not evidence of accepted coverage. Syndicated issuer releases count as one issuer, not independent journalism. Unknown origin fails diversity until reviewed. Calendar months intersecting the window include partial first/current months; ten distinct stories is the alternative pass criterion.',summary:{stocks:rows.length,volumePass:rows.filter(r=>r.volumePass).length,sourceDiversityPass:rows.filter(r=>r.sourceDiversityPass).length,bothPass:rows.filter(r=>r.volumePass&&r.sourceDiversityPass).length,officialAutomatedFeed:rows.filter(r=>r.officialAutomatedFeed).length},stocks:rows};
writeFileSync('docs/stonklets-news-quality.json',JSON.stringify(report,null,2)+'\n');
const table=rows.map(r=>`| ${r.name} | ${r.stories} | ${months.length-r.missingMonths.length}/${months.length} | ${r.volumePass?'PASS':'GAP'} | ${r.sourceDiversityPass?'PASS':'GAP'} | ${r.independentOwners.join(', ')||'None verified'} |`).join('\n');
writeFileSync('docs/stonklets-news-quality.md',`# News quality audit\n\nChecked ${report.checkedAt}.\n\n${report.method}\n\n${report.summary.volumePass}/44 pass volume; ${report.summary.sourceDiversityPass}/44 pass primary plus independent source diversity; ${report.summary.bothPass}/44 pass both. Only ${report.summary.officialAutomatedFeed}/44 have an enabled official RSS feed. A homepage is not an automated feed.\n\n| Stock | Stories | Months covered | Volume | Source diversity | Independent publishers |\n|---|---:|---:|---|---|---|\n${table}\n\nThe JSON companion includes every counted source URL, publication date, missing month and configured discovery feed. This is an audit, not a claim that gaps contain no news. Do not publish routine earnings schedules, mixed results or duplicate syndication to meet the count.\n`);
console.log(JSON.stringify(report.summary));

if(process.argv.includes("--check") && report.summary.bothPass!==rows.length) process.exitCode=1;

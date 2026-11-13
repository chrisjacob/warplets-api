import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createServer as httpServer} from 'node:http';
import {fileURLToPath} from 'node:url';

const profile={wallet:'synthetic-participant-wallet',label:'Synthetic participant',asOf:'2026-11-13T00:00:00.000Z',peakUsdMicros:'123456789000',marketUsdMicros:'1234',tokenCount:3,allocationCount:40,activeDays:30,firstAwardAt:'2026-08-01T00:00:00.000Z',categories:[{category:'nfts',allocationCount:10},{category:'stake',allocationCount:10},{category:'earn',allocationCount:20}],history:[]};
test('performance card escapes hostile text, retains both valuations and synthetic disclosures, and rejects unsafe or unpriced input',async t=>{
 const vite=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{middlewareMode:true,hmr:{server:httpServer()}},appType:'custom',logLevel:'error'});t.after(()=>vite.close());
 const {buildPerformanceCardSvg,earnedMilestones}=await vite.ssrLoadModule('/src/performance-growth.tsx');
 const svg=buildPerformanceCardSvg({...profile,label:'<script> & "A" \'B\''});
 assert.match(svg,/&lt;script&gt; &amp; &quot;A&quot; &apos;B&apos;/);assert.doesNotMatch(svg,/<script|<foreignObject|<image|href=/);
 for(const text of ['SYNTHETIC QA','THEORETICAL LIFETIME AWARDS','Peak valuation','Market valuation','US$123,456.78','&lt; US$0.01','Snapshot 2026-11-13 00:00 UTC','No real funds or verified achievement'])assert(svg.includes(text),text);
 assert(svg.length<10000);assert.equal(buildPerformanceCardSvg(profile),buildPerformanceCardSvg(profile));
 for(const patch of [{peakUsdMicros:null},{marketUsdMicros:null},{marketUsdMicros:'-1'},{peakUsdMicros:'1e9'},{peakUsdMicros:'9'.repeat(101)},{wallet:'x"><script>'},{label:'bad\u0000label'},{label:'bad\ud800label'},{asOf:'2026-02-31T00:00:00.000Z'},{tokenCount:Infinity},{allocationCount:-1},{activeDays:41}])assert.throws(()=>buildPerformanceCardSvg({...profile,...patch}));
 assert.match(buildPerformanceCardSvg({...profile,peakUsdMicros:'9'.repeat(100)}),/≈ US\$9\.99e\+93/);
 assert.deepEqual(earnedMilestones(profile).map(item=>item.id),['first','days','categories']);
 assert.deepEqual(earnedMilestones({...profile,allocationCount:0,activeDays:0,firstAwardAt:null,categories:[]}),[]);
 assert.deepEqual(earnedMilestones({...profile,activeDays:29,categories:[{category:'earn',allocationCount:1},{category:'earn',allocationCount:1},{category:'earn',allocationCount:1}]}).map(item=>item.id),['first']);
});

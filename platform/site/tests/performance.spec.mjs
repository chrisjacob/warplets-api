import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createServer as httpServer} from 'node:http';
import {fileURLToPath} from 'node:url';
test('performance presentation preserves missing prices and token precision, and rejects oversized board payloads',async t=>{
 const vite=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{middlewareMode:true,hmr:{server:httpServer()}},appType:'custom',logLevel:'error'});t.after(()=>vite.close());
 const {usd,performanceBoard,performanceProfile}=await vite.ssrLoadModule('/src/performance.tsx');
 assert.equal(usd(null),'Unavailable');assert.equal(usd('0'),'US$0.00');assert.equal(usd('9999'),'< US$0.01');assert.equal(usd('1234567890123456'),'US$1,234,567,890.12');
 const row={rank:1,participantId:'synthetic',wallet:null,label:'Synthetic',peakUsdMicros:null,marketUsdMicros:'0',tokenCount:1,allocationCount:1,awardedTokens:[{tokenId:'a',symbol:'A',decimals:9,awardedUnits:'9007199254740993',claimableUnits:'1'}],multiple:null};
 const board={mode:'synthetic-local',asOf:'2026-11-13T00:00:00Z',category:'tokens',valuationMode:'peak',totalParticipants:1,unrankedCount:1,items:[row],myRank:null};
 assert.equal(performanceBoard.parse(board).items[0].peakUsdMicros,null);assert.throws(()=>performanceBoard.parse({...board,items:Array(101).fill(row)}));assert.throws(()=>performanceBoard.parse({...board,items:[{...row,marketUsdMicros:'-1'}]}));
 assert.equal(performanceProfile.safeParse({}).success,false);
});

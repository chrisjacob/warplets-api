// Dated evidence and explicit scenario counts, never live transaction prices.
import { readFileSync } from 'node:fs';
const source='../lab/KAMINO.md';
const farm=JSON.parse(readFileSync(new URL('../lab/fixtures/kamino-public.json',import.meta.url),'utf8')).farmSnapshot;
const observedMs=Date.parse(farm.retrievedAt);
const coreObserved=Date.UTC(2026,10,5);
function rent(amount,bytes) {
  return {unit:'lamport',amount:String(amount),kind:'reference',observedMs,sourceRef:source,
    accountLayoutRef:`${bytes}-byte example account; creation/existence must be checked`,refundable:'unverified'};
}
export function referenceScenarioInput(asOfMs=Date.now()) {
  return {asOfMs,parameters:{freshAtasPerUser:1,newStakers:1,dailyClaimants:100,seasonPaid:900,seasonFree:100,seasonFounder:0,
    upgradeCount:1,upgradeLevel:1,rerollCount:1,priorRerolls:0,unsoldFounderMints:0},
    quotes:{farmStateRent:rent(42_997_120,8336),farmUserRent:rent(5_323_840,920),classicAtaRent:rent(1_488_440,165),
      coreProtocol:{unit:'lamport',amount:'1500000',kind:'reference',observedMs:coreObserved,
        sourceRef:'https://www.metaplex.com/docs/smart-contracts/core/faq',refundable:false}}};
}

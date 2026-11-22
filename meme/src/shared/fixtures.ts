import type {LaunchpadPreview} from './contracts';
export const preview:LaunchpadPreview={
 mode:'fixture',actionsEnabled:false,asOf:'2026-10-29T12:00:00Z',
 participant:{fid:42,solanaWallet:null,baseWallets:[]},
 round:{id:'preview-round',opensAt:'2026-10-29T00:00:00Z',closesAt:'2026-10-29T19:30:00Z',state:'open',selectedCandidateId:null,finality:'provisional',candidates:[
  {id:'orbit',name:'Orbit',symbol:'ORBIT',ogMint:'fixture:orbit-og',uniqueVoters:142,weightedVotes:508.2,screening:'reviewed',evidence:['Momentum and liquidity reviewed in this fixture']},
  {id:'moss',name:'Moss',symbol:'MOSS',ogMint:'fixture:moss-og',uniqueVoters:97,weightedVotes:311.5,screening:'reviewed',evidence:['Ownership concentration reviewed in this fixture']},
  {id:'pixel',name:'Pixel',symbol:'PIXEL',ogMint:'fixture:pixel-og',uniqueVoters:63,weightedVotes:194.4,screening:'pending',evidence:[]}
 ]},
 boost:{base:1,warplet:2.4,holding:1.8,streak:0.6,total:5.8,featuredAttribute:'Featured attribute · fixture',eligibleLevel:8,ownershipFrozenAt:'2026-10-28T23:59:00Z',rewardPoints:58,voteWeight:5.8,finality:'provisional'},
 editions:[{id:'edition-01',name:'10X Orbit',symbol:'10XORBIT',tokenMint:'fixture:edition-01',ogMint:'fixture:orbit-og',launchedAt:'2026-10-27T20:00:00Z',state:'launched',finality:'final'}],
 campaigns:[{editionId:'edition-01',totalSupply:'1000000000',liquidityBps:9000,rewardsBps:1000,releaseCount:10,firstReleaseAt:'2026-10-28T20:00:00Z',lastReleaseAt:'2026-11-06T20:00:00Z',finality:'final'}],
 entitlements:[{id:'entitlement-01',editionId:'edition-01',roundId:'preview-prior-round',fid:42,amount:'45120',releaseAt:'2026-10-28T20:00:00Z',finality:'final'}],
 claims:[{id:'claim-01',entitlementIds:['entitlement-01'],state:'available',transactionSignatures:[],finality:'final'}]
};

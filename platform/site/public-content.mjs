// Public presentation only. Never use this file to allocate funds or activate a launch.
export const brand = Object.freeze({
 name:'10X', headline:'10X Everything.',
 worldview:'The future is exponential.',
 philosophy:'10X, not 10%.', mindset:'Think 10X. Not 10%.',
 culture:'Celebrate the extraordinary.', mission:'Unlock exponential potential.',
 mediaStrategy:'Showcase epic moments.',
 economicThesis:'Attention creates asymmetric opportunities.',
 businessModel:'Monetise attention through tokenisation.',
 strategicPositioning:'The Red Bull of Memecoins.',
 manifesto:Object.freeze(['THE FUTURE IS EXPONENTIAL.','THINK 10X. NOT 10%.','10X EVERYTHING.']),
 cta:'Think 10X.',
 description:'The future is exponential. 10X celebrates extraordinary achievements through original memecoins, attention and collectibles.',
 risk:'Memecoins are speculative and can lose their entire value. 10X is a brand philosophy, not a promise of returns.',
});
export const products = Object.freeze({
 original:Object.freeze({id:'original',name:'10X Meme',plural:'10X Memes',cadence:'Target: one per month',purpose:'Original memecoins. One new cultural idea at a time.',detail:'Our core product: culture-led memecoins with their own identity and community.',path:'/tokens',hash:'tenx-meme'}),
 genesis:Object.freeze({id:'genesis',name:'10X NFT',plural:'10X NFTs',cadence:'10,000 · one permanent collection',purpose:'Your ongoing connection to 10X.',detail:'Permanent digital collectibles with Level-based benefits under the published rules. Eligibility still applies.',path:'/collections/genesis',hash:''}),
 attention:Object.freeze({id:'attention',name:'Attention Token',plural:'Attention Tokens',cadence:'Target: up to one daily spotlight',purpose:'Focus the trenches. Discover selected memecoins.',detail:'Separate tokens that support attention campaigns around selected memes. They are not the selected meme itself.',path:'/tokens',hash:'attention-tokens'}),
 season:Object.freeze({id:'season',name:'10X Cards',plural:'10X Cards',cadence:'1,000 per monthly edition',purpose:'A new season. A reason to return.',detail:'Limited digital collectibles with seasonal utility. Utility expiry does not end ownership or erase past allocations.',path:'/nfts',hash:'season-0'}),
});
// Confirmed presentation terms from the 2026-11-24 brief; operational SOL stages stay untouched.
// No approved campaign dates, release activation or verified $10X contract found in the checkout.
export const firstLaunch = Object.freeze({
 seasonId:'season-0',seasonLabel:'Season 0',name:'10X',ticker:'$10X',
 state:'planned',status:'Standalone beta · not scheduled',contract:null,chain:null,
 collectibleSupply:1000,betaMintUsd:1,standardMintUsd:10,
 pairedCampaign:Object.freeze({startsAt:null,endsAt:null,timeZone:'UTC'}),
});
export const roadmap = Object.freeze([
 {title:'Season 0 — standalone beta',status:'Not scheduled',detail:'The first 10X Meme: $10X. A 1,000-card edition with a US$1 beta mint plan and a separate paired Attention Token campaign, subject to readiness.'},
 {title:'Learn from the beta',status:'Readiness review',detail:'Validate participation, operations and technical readiness before scheduling another launch.'},
 {title:'Monthly 10X Memes + Cards',status:'Planned · no launch date',detail:'Target one original and one 1,000-card edition per month. Intended standard card mint: US$10, subject to release configuration.'},
 {title:'Daily Attention Tokens',status:'Planned · no start date',detail:'Target up to one new spotlight per day. Skips and extensions are allowed; reward campaigns can overlap.'},
 {title:'Permanent 10X NFT',status:'Planned · release dependencies apply',detail:'A one-time 10,000 collection. Activation follows the approved release plan; it is not assumed to mint with the beta.'},
]);
export function campaignSchedule(campaign=firstLaunch.pairedCampaign){
 if(!campaign.startsAt||!campaign.endsAt)return 'Dates to be confirmed';
 const start=Date.parse(campaign.startsAt),end=Date.parse(campaign.endsAt);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return 'Dates to be confirmed';
 const format=new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:campaign.timeZone});
 return format.format(start)+' – '+format.format(end)+' ('+campaign.timeZone+')';
}
export function collectionName(kind){return kind==='genesis'?products.genesis.name:kind==='season'?products.season.name:'Collectible';}

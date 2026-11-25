export type ProductId='original'|'genesis'|'attention'|'season';
export type PublicProduct=Readonly<{id:ProductId;name:string;plural:string;cadence:string;purpose:string;detail:string;path:'/tokens'|'/collections/genesis'|'/attention'|'/nfts';hash:string}>;
export const brand:Readonly<{name:string;headline:string;worldview:string;mission:string;philosophy:string;mindset:string;culture:string;mediaStrategy:string;economicThesis:string;businessModel:string;strategicPositioning:string;manifesto:readonly string[];cta:string;description:string;risk:string}>;
export const products:Readonly<Record<ProductId,PublicProduct>>;
export type CampaignSchedule=Readonly<{startsAt:string|null;endsAt:string|null;timeZone:string}>;
export const firstLaunch:Readonly<{seasonId:string;seasonLabel:string;name:string;ticker:string;state:'planned';status:string;contract:null;chain:null;collectibleSupply:number;betaMintUsd:number;standardMintUsd:number;pairedCampaign:CampaignSchedule}>;
export const roadmap:ReadonlyArray<Readonly<{title:string;status:string;detail:string}>>;
export function campaignSchedule(campaign?:CampaignSchedule):string;
export function collectionName(kind:string):string;

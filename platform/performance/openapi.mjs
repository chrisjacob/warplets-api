// Optional local extensions. Advertised only when their synthetic sources are injected.
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const string={type:'string'},integer={type:'integer',minimum:0},units={type:'string',pattern:'^[0-9]+$',maxLength:256},iso={type:'string',format:'date-time'};
const nullable=value=>({anyOf:[value,{type:'null'}]}),array=(items,maxItems)=>({type:'array',items,...(maxItems?{maxItems}:{})});
const category={enum:['tokens','nfts','airdrops','stake','earn']},source={enum:['nfts','stake','earn']};
const meta={mode:{const:'synthetic-local'},asOf:iso};
const amounts={peakUsdMicros:nullable(units),marketUsdMicros:nullable(units)};
const token={tokenId:string,symbol:string,decimals:{type:'integer',minimum:0,maximum:18},awardedUnits:units,claimableUnits:units};
const row=object({rank:{type:'integer',minimum:1},participantId:string,wallet:nullable(string),label:string,...amounts,tokenCount:integer,allocationCount:integer,awardedTokens:array(object(token),3),multiple:nullable(string)});
const award={id:string,category:source,tokenId:string,symbol:string,decimals:token.decimals,awardedUnits:units,awardedAt:iso};
const board=object({...meta,category,valuationMode:{enum:['peak','market']},totalParticipants:integer,unrankedCount:integer,items:array(row,100),myRank:nullable(row)});
const profile=object({...meta,wallet:string,label:string,...amounts,valuationComplete:{type:'boolean'},tokenCount:integer,allocationCount:integer,activeDays:integer,firstAwardAt:nullable(iso),history:array(object(award),5),categories:array(object({category:source,...amounts,allocationCount:integer}),3),ranks:object(Object.fromEntries(['airdrops','nfts','stake','earn'].map(k=>[k,nullable({type:'integer',minimum:1})]))),items:array(object({...token,...amounts}),100),nextCursor:nullable(string)});
const parameter=(name,schema,location='query')=>({in:location,name,required:location==='path',schema});
const endpoint=(operationId,summary,schema,parameters=[])=>({get:{operationId,summary,parameters,responses:{200:{description:summary,content:{'application/json':{schema}}},400:{description:'Invalid request'},404:{description:'Unknown participant or route'},503:{description:'Synthetic data source unavailable'}}}});
export const performancePaths={
 '/performance/boards/{category}':endpoint('readSyntheticPerformanceBoard','Read the bounded synthetic local performance ranking.',board,[parameter('category',category,'path'),parameter('mode',{enum:['peak','market']}),parameter('limit',{type:'integer',minimum:1,maximum:100})]),
 '/performance/profiles/{wallet}':endpoint('readSyntheticPerformanceProfile','Read synthetic lifetime awards, claimable units and bounded history.',profile,[parameter('wallet',string,'path'),parameter('cursor',integer),parameter('limit',{type:'integer',minimum:1,maximum:100})]),
 '/performance/activity':endpoint('readSyntheticPerformanceActivity','Read recent synthetic awards.',object({...meta,items:array(object({...award,wallet:string,label:string}),50)}),[parameter('limit',{type:'integer',minimum:1,maximum:50})]),
};
export const qaReviewPaths={'/qa/content-review':endpoint('readSyntheticReviewPreview','Read an explicitly synthetic scoring example, never a real submission judgment.',object({reportId:string,submissionId:string,label:{const:'SIMULATION — not an AI judgment'},simulation:{const:true},suggestedScore:{type:'integer',minimum:0,maximum:10},scoreMaximum:{const:10},status:{const:'ready-for-operator-review'},rubricVersion:string,summary:string,criteria:array(object({id:string,label:string,score:{type:'integer',minimum:0,maximum:5},maximum:{const:5},rationale:string,improvement:string}),4),uncertainty:{enum:['low','medium','high']},reviewNeeded:{const:false},flags:array(string),appealAvailable:{type:'boolean'},previousReportId:nullable(string),financialExecution:{const:false}}))};

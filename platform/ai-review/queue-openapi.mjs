const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const str={type:'string'},integer={type:'integer'},bool={type:'boolean'},nullable=s=>({anyOf:[s,{type:'null'}]}),array=items=>({type:'array',items});
export const reviewFeedbackSchema=object({
 submissionId:str,status:{enum:['awaiting-capture','ready','running','completed','failed','unknown','held']},
 feedback:nullable(object({reportId:str,submissionId:str,label:str,simulation:bool,suggestedScore:{type:'integer',minimum:0,maximum:10},scoreMaximum:{const:10},
  status:{enum:['needs-investigation','ready-for-operator-review']},rubricVersion:str,summary:str,
  criteria:array(object({id:str,label:str,score:{type:'integer',minimum:0,maximum:5},maximum:{const:5},rationale:str,improvement:str})),
  uncertainty:{enum:['low','medium','high']},reviewNeeded:bool,flags:array(str),appealAvailable:bool,previousReportId:nullable(str),financialExecution:{const:false}})),
 finalReview:nullable(object({score:{type:'integer',minimum:0,maximum:10},reviewedAtMs:integer})),
 appeal:object({eligible:bool,reason:nullable(str),latest:nullable(object({appealId:str,status:{enum:['awaiting-independent-review','reviewed']},reportId:str,createdAt:{type:'string',format:'date-time'}}))}),
 paidCallsEnabled:{const:false}
});
const response=description=>({description,content:{'application/json':{schema:reviewFeedbackSchema}}});
const path={in:'path',name:'submissionId',required:true,schema:{type:'string',maxLength:128}};
export const reviewQueuePaths={
 '/earn/submissions/{submissionId}/review':{get:{operationId:'getEarnReviewFeedback',summary:'Read your submission’s private review status and feedback.',parameters:[path],responses:{200:response('Private feedback; suggestions do not change final scores'),401:{description:'Wallet session required'},404:{description:'Unknown submission'},429:{description:'Read limit'}}}},
 '/earn/submissions/{submissionId}/appeals':{post:{operationId:'submitEarnReviewAppeal',summary:'Request one independent review of the current suggestion before final moderation.',parameters:[path,{in:'header',name:'Idempotency-Key',required:true,schema:{type:'string',maxLength:128}}],
 requestBody:{required:true,content:{'application/json':{schema:object({reportId:{type:'string',pattern:'^[a-f0-9]{64}$'},reason:{type:'string',minLength:1,maxLength:2000}})}}},
 responses:{201:response('Appeal recorded durably'),200:response('Idempotent replay'),400:{description:'Invalid appeal'},401:{description:'Wallet session required'},403:{description:'Origin refused'},404:{description:'Unknown submission'},409:{description:'Report changed, appeal already exists or final review completed'},429:{description:'Appeal limit'}}}}
};

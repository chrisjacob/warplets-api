const response = description => ({description,content:{'application/json':{schema:{type:'object'}}}});
const cursor = {in:'query',name:'cursor',schema:{type:'integer',minimum:0},description:'Continue from nextCursor.'};
export const earnPaths = {
  '/earn/submissions':{post:{operationId:'submitEarnContent',summary:'Submit one content URL for an active local ATT campaign with a verified wallet session.',
    parameters:[{in:'header',name:'Idempotency-Key',required:true,schema:{type:'string',maxLength:128}}],
    requestBody:{required:true,content:{'application/json':{schema:{type:'object',additionalProperties:false,
      required:['tokenId','url'],properties:{tokenId:{type:'string'},url:{type:'string',format:'uri',maxLength:2048}}}}}},
    responses:{201:response('Submitted'),200:response('Idempotent replay'),401:response('Wallet session required'),
      409:response('Campaign, submission limit or key conflict'),422:response('Stake below threshold'),503:response('Local stake evidence missing')}}},
  '/earn/epochs/{epoch}/leaderboard':{get:{operationId:'getEarnLeaderboard',summary:'Read the global UTC board, allocations and burns.',
    parameters:[{in:'path',name:'epoch',required:true,schema:{type:'string',format:'date'}}],responses:{200:response('Pending or finalized local board')}}},
  '/earn/me':{get:{operationId:'getMyEarnSubmissions',summary:'Read your content and finalized moderation decisions.',
    parameters:[cursor],responses:{200:response('Submissions'),401:response('Wallet session required')}}},
  '/earn/claims':{get:{operationId:'getMyEarnClaims',summary:'Preview your local fixture awards and vested units.',
    parameters:[cursor],responses:{200:response('Vesting preview with execution disabled'),401:response('Wallet session required')}}},
};

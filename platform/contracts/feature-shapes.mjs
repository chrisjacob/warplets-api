// Payloads before the negotiated v1 envelope is added.
export const s={type:'string'},i={type:'integer'},b={type:'boolean'},u={type:'string',pattern:'^(0|[1-9][0-9]*)$'};
export const o=(properties,required=Object.keys(properties))=>({type:'object',properties,required});
export const a=items=>({type:'array',items});
export const n=x=>({anyOf:[x,{type:'null'}]});
export const r=name=>({$ref:'#/components/schemas/'+name});
const iso={type:'string',format:'date-time'};
const local={const:'local-fixture'},ms={type:'integer',minimum:0};
const commonSubmission={id:s,tokenId:s,epoch:i,url:{type:'string',format:'uri'},submittedAtMs:ms};
const winner={userId:s,wallet:s,submissionId:s,tokenId:s,submittedAtMs:ms,contentScore:{type:'integer',minimum:1,maximum:10},
  multiplierTenths:{type:'integer',minimum:1,maximum:100},pointsTenths:{type:'integer',minimum:1,maximum:1000}};
const allocation={tokenId:s,day:{type:'integer',minimum:1,maximum:10},budgetUnits:u,burnUnits:u,vestsFromMs:ms,vestsThroughMs:ms};
export const featureShapes={
  EarnMemberStatus:o({mode:local,asOf:iso,epoch:i,
    admission:o({status:{enum:['complete','unavailable']},reason:n(s),items:a(o({tokenId:s,status:{enum:['accepted','eligible','pending','held']},reason:n(s),stakeMicroUsd:n(u),stakeObservedAt:n(iso),sourceRef:n(s)}))}),
    actions:o({status:{enum:['complete','unavailable']},reason:n(s),items:a(o({actionId:s,label:s,verifier:s,startEpoch:i,status:{enum:['verified','pending']},verifiedAt:n(iso),sourceRef:n(s)}))}),
    currentCutoff:o({status:{const:'pending'},reason:{const:'board-not-sealed'},cutoffAt:iso}),
    latestFinalComponents:n(o({epoch:i,cutoffAt:iso,actionTenths:i,streakDays:i,highestEligibleLevel:i,purchaseTokenDays:i,multiplierTenths:i,sourceRef:s,snapshotDigest:s})),
    multiplierBounds:o({minimumTenths:{const:1},maximumTenths:{const:100}})}),
  EarnWinner:o({...winner,rank:{type:'integer',minimum:1,maximum:100}}),
  EarnAllocation:o(allocation),
  EarnComponents:o({actionTenths:i,streakDays:i,highestEligibleLevel:i,purchaseTokenDays:i,sourceRef:s}),
  EarnOwnSubmission:o({...commonSubmission,status:{enum:['pending','final']},score:n(i),eligible:n(b),reason:n(s),components:n(r('EarnComponents')),
    entryStakeMicroUsd:u,closingStakeMicroUsd:n(u)}),
  EarnClaim:o({tokenId:s,day:i,awardUnits:u,vestedUnits:u,vestsFromMs:ms,vestsThroughMs:ms}),
  EarnAction:o({actionId:s,label:s,verifier:s,startEpoch:i}),
  EarnProofContext:o({boardId:s,tokenId:s,day:i,vestsFromMs:ms,vestsThroughMs:ms}),
  EarnAward:o({wallet:s,amountUnits:u}),
  EarnProof:o({format:{const:'10x.local.earn.public.v1'},context:r('EarnProofContext'),award:r('EarnAward'),
    path:a(o({side:{enum:['left','right']},hash:s})),root:s}),
  EarnManifest:o({format:{const:'10x.local.earn.public.v1'},boardId:s,
    board:o({epoch:i,finalizedAtMs:ms,snapshotId:s,winners:a(o(winner))}),
    allocations:a(o({...allocation,boardId:s,activationMs:ms,originalUnits:u,startsAtMs:ms,awards:a(r('EarnAward')),awardRoot:s}))}),
  ActionCompletionProof:o({domain:{const:'10x.local.earn-action.v1'},issuerId:s,grantRevision:s,actionId:s,wallet:s,nonce:s,
    issuedAtMs:ms,expiresMs:ms,sourceHash:s}),
  NoticePreferences:o({channel:{const:'local-inbox'},revision:i,enabled:b,topics:a({enum:['launch','voting','rewards']}),
    terms:{const:'10x-notice-local-inbox-v1'},changedAtMs:n(ms)}),
  LocalNotice:o({id:s,topic:{enum:['launch','voting','rewards']},title:s,message:s,target:s,deliveredMs:ms}),
  OperationScope:o({scope:s,allowed:b,reason:s,revision:n(s)},['scope','allowed','reason']),
  GenesisBallot:o({id:s,source:local,status:{enum:['scheduled','open','closed']},opensAt:s,closesAt:s,choices:a({enum:['ASAP','7','14','30']}),
    eligibleWallets:i,votesCast:i,counts:n(o({ASAP:i,'7':i,'14':i,'30':i})),
    decision:n(o({choice:{enum:['ASAP','7','14','30']},rationale:s,earliestOpening:s}))}),
  Farm:o({marketId:s,fundedUnits:u,treasuryFeeBps:i,activationTime:s,emissionEnd:s,asOf:s,source:local,executable:{const:false},
    status:{enum:['scheduled','active','ended']},totalStakedUnits:u,earnedGrossUnits:u,unusedRecoverableUnits:u,roundingReserveUnits:u},
    ['marketId','fundedUnits','treasuryFeeBps','activationTime','emissionEnd','asOf','source','executable','status']),
  TransactionIntent:o({id:s,action:s,subject:s,state:s,revision:i,planHash:s,attemptId:n(s),source:{const:'local-rehearsal'},executable:{const:false}}),
};
export const rawFeatureSuccess={
  getGenesisBallot:r('GenesisBallot'),
  listGenesisBallots:o({items:a(r('GenesisBallot')),nextCursor:{type:'null'},asOf:s}),
  getFarm:r('Farm'),getTransaction:r('TransactionIntent'),
  getEarnLeaderboard:o({mode:local,epoch:i,date:s,status:{enum:['pending','final']},items:a(r('EarnWinner')),allocations:a(r('EarnAllocation')),
    snapshotId:n(s),finalizedAtMs:n(ms),source:{const:'public-archive'}},
    ['mode','epoch','date','status','items','allocations','snapshotId','finalizedAtMs']),
  submitEarnContent:o({mode:local,...commonSubmission}),
  getMyEarnSubmissions:o({mode:local,items:a(r('EarnOwnSubmission')),nextCursor:n(i),memberStatus:r('EarnMemberStatus')},['mode','items','nextCursor']),
  getMyEarnClaims:o({mode:local,executionEnabled:{const:false},items:a(r('EarnClaim')),nextCursor:n(i),source:{const:'public-archive'}},
    ['mode','executionEnabled','items','nextCursor']),
  listActiveEarnActions:o({mode:local,epoch:i,items:a(r('EarnAction'))}),
  getEarnAdmissionCapacity:o({mode:local,epoch:i,limit:i,admitted:i,remaining:i,accepting:b,policy:s}),
  exportEarnManifest:o({sha256:s,manifest:r('EarnManifest')}),
  getMyEarnProof:o({mode:local,manifestDigest:s,proof:r('EarnProof')}),
  submitSignedActionCompletion:o({actionId:s,verifiedAtMs:ms,proofDigest:s,replay:b}),
  getLocalOperationStatus:o({mode:local,boundary:{const:'application-only'},scopes:a(r('OperationScope')),protectedScopes:a(s)}),
  getNoticeCapabilities:o({channel:{const:'local-inbox'},topics:a(s),terms:s,delivery:s,externalTransport:{const:false},dailyLimit:i}),
  getMyNoticePreferences:r('NoticePreferences'),
  setMyNoticePreferences:o({appliedRevision:i,preference:r('NoticePreferences'),replay:b}),
  getMyLocalNotices:o({mode:{const:'local-inbox'},items:a(r('LocalNotice')),nextCursor:n(s)}),
};

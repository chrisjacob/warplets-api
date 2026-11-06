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
const closed=properties=>({...o(properties),additionalProperties:false});
const hash={type:'string',pattern:'^[a-f0-9]{64}$'},choice=closed({name:s,weight:i});
const fairnessBase={format:{const:'10x.local.fairness.v1'},source:local,providerStatus:{const:'candidate-unselected'},requiresVerifiedRepository:{const:true},requestState:{enum:['waiting','assigned','held']},evidenceState:{enum:['manual-fixture','retained-unverified','conflicted','verified','waiting-prior-admission','waiting-entropy','waiting-fulfillment']},financialState:{const:'not-applicable-local'},commitment:hash,financialExecution:{const:false},serverSigning:{const:false},broadcast:{const:false}};
const mintTranscript=closed({format:{const:'10x.recorded-draw-transcript.v1'},verificationScope:{const:'recorded-beacon-draw-only'},requestPreimage:{type:'array',minItems:9,maxItems:9,items:{anyOf:[s,i]}},contextDigest:hash,policyHash:hash,publicTraitChoices:n(closed({model:a(choice),backdrop:a(choice),symbol:a(choice)})),proof:closed({chain:s,round:i,signature:s,randomness:s}),fixture:{anyOf:[closed({operationId:s,commitment:s,proofId:hash,at:ms,finalized:{const:true},traits:closed({model:s,backdrop:s,symbol:s}),ticket:i,assetId:s}),closed({operationId:s,commitment:s,proofId:hash,at:ms,finalized:{const:true},ticket:{type:'integer',minimum:0,maximum:999}}),closed({operationId:s,commitment:s,proofId:hash,at:ms,finalized:{const:true},traits:closed({model:s,backdrop:s,symbol:s})})]},selectedAssignment:closed({assetId:s,level:n(i)}),remainingQuotas:n({type:'array',minItems:10,maxItems:10,items:i}),reservedAssetMapping:{const:'withheld'},policyClosure:{const:'requires-trusted-retained-policy'},productionOrderAndCustody:{const:'unverified'},digest:hash});
const refreshFlags={source:local,financialState:{const:'not-applicable-local'},financialExecution:{const:false},metadataApplied:{const:false},isAuthorization:{const:false},serverSigning:{const:false},broadcast:{const:false}};
export const featureShapes={
  RefreshOwnerView:closed({requestId:s,assetId:s,inventoryId:s,requestOwner:s,expectedAssetVersion:i,revision:i,stateDigest:hash,requestState:{enum:['draft','reference-validated','moderation-pending','preview-ready','owner-approved','fulfillment-pending','fulfilled','failed','rejected','owner-changed']},evidenceState:s,referenceDigest:hash,quoteDigest:hash,providerKind:{enum:['unselected','recorded-synthetic-fixture']},preview:n(closed({previewDigest:hash,moderationDigest:hash,provenance:{const:'recorded-synthetic-fixture'}})),approval:n(closed({assetVersion:i,approvedMs:ms})),hold:n(closed({reason:s,atMs:ms})),previewPresentation:{const:'digest-only-recorded-fixture'},currentOwnership:{const:'rechecked-on-action'},quoteTerms:{const:'retained-digest-only'},...refreshFlags}),
  RefreshOwnerPrepared:closed({kind:{const:'prepared'},token:s,commandDigest:hash,capturedAtMs:ms,expiresAtMs:ms,requestKey:s,requestId:s,action:{enum:['approve','request-fulfillment']},expectedRevision:i,expectedStateDigest:hash,previewDigest:hash,quoteDigest:hash,preparationAuthority:{const:'ephemeral-same-session'},...refreshFlags}),
  RefreshOwnerReceipt:closed({kind:{enum:['committed','replayed']},projection:{const:'safe-refresh-reference-v1'},value:closed({requestId:s,assetId:s,revision:i,stateDigest:hash}),receipt:closed({operationId:s,requestKey:s,requestDigest:hash,outputDigest:hash}),outputDigestScope:{const:'original-private-revision-reference'},...refreshFlags}),
  RefreshOwnerPending:closed({kind:{const:'pending'},reason:s,dependencyIds:a(s)}),
  RefreshOwnerActionResult:{anyOf:[r('RefreshOwnerPrepared'),r('RefreshOwnerReceipt'),r('RefreshOwnerPending')]},

  CollectionFairness:{anyOf:[closed({...fairnessBase,disclosure:{const:'sealed'},transcript:{type:'null'}}),closed({...fairnessBase,disclosure:{const:'revealed'},transcript:mintTranscript})]},
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
  TransactionIntent:o({id:s,action:s,subject:s,state:{enum:['validated','awaiting_signature','attempt_expired','submitted','unknown','confirmed','failed','finalized']},revision:i,planHash:s,attemptId:n(s),source:{const:'local-rehearsal'},executable:{const:false},financialExecution:{const:false},provenance:{const:'legacy-recorded-unverified'},createdAtMs:ms,planExpiresAtMs:ms,asOfMs:ms,attemptCount:i,
    currentAttempt:n(o({id:s,index:i,state:s,messageHash:s,blockhash:s,lastValidBlockHeight:i,contextSlot:i,observedAtMs:ms,hasRecordedSignature:b})),
    receiptObservations:a(o({eventId:s,attemptId:s,state:{enum:['unknown','confirmed','failed','finalized']}})),
    nextLocalTransition:{enum:['prepare-recorded-packet','observe-or-expire-unsubmitted','replace-expired-unsubmitted','reconcile-existing-attempt','none']},requiredObservation:n({enum:['fresh-verified-preparation','recorded-block-height-or-submission','same-attempt-recorded-outcome']}),replacementEligible:b}),
};
export const rawFeatureSuccess={
  getMyRefreshProposal:{anyOf:[closed({kind:{const:'found'},value:r('RefreshOwnerView')}),r('RefreshOwnerPending')]},prepareMyRefreshAction:r('RefreshOwnerActionResult'),executeMyRefreshAction:r('RefreshOwnerActionResult'),getMyRefreshActionReceipt:r('RefreshOwnerActionResult'),
  readMyCollectionFairness:r('CollectionFairness'),
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

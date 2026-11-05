// Generated from openapi.json.
export const operations = [
  {
    "id": "getCapabilities",
    "path": "/capabilities",
    "method": "GET"
  },
  {
    "id": "getPolicy",
    "path": "/policy",
    "method": "GET"
  },
  {
    "id": "listCollections",
    "path": "/collections",
    "method": "GET"
  },
  {
    "id": "getHealth",
    "path": "/health",
    "method": "GET"
  },
  {
    "id": "createWalletChallenge",
    "path": "/auth/challenges",
    "method": "POST"
  },
  {
    "id": "verifyWalletSignature",
    "path": "/auth/verify",
    "method": "POST"
  },
  {
    "id": "revokeSession",
    "path": "/auth/logout",
    "method": "POST"
  },
  {
    "id": "getProfile",
    "path": "/me",
    "method": "GET"
  },
  {
    "id": "getWallets",
    "path": "/me/wallets",
    "method": "GET"
  },
  {
    "id": "listMarkets",
    "path": "/markets",
    "method": "GET"
  },
  {
    "id": "getMarket",
    "path": "/markets/{id}",
    "method": "GET"
  },
  {
    "id": "getFeeSchedule",
    "path": "/launch/fee-schedule",
    "method": "GET"
  },
  {
    "id": "listLaunchPlans",
    "path": "/launch-plans",
    "method": "GET"
  },
  {
    "id": "previewLaunchPlan",
    "path": "/launch-plans/preview",
    "method": "POST"
  },
  {
    "id": "listGenesisBallots",
    "path": "/genesis/ballots",
    "method": "GET"
  },
  {
    "id": "getGenesisBallot",
    "path": "/genesis/ballots/{id}",
    "method": "GET"
  },
  {
    "id": "castGenesisVote",
    "path": "/genesis/ballots/{id}/votes",
    "method": "POST"
  },
  {
    "id": "submitSignedActionCompletion",
    "path": "/earn/actions/{actionId}/completions",
    "method": "POST"
  },
  {
    "id": "getEarnAdmissionCapacity",
    "path": "/earn/capacity",
    "method": "GET"
  },
  {
    "id": "exportEarnManifest",
    "path": "/earn/epochs/{epoch}/manifest",
    "method": "GET"
  },
  {
    "id": "getMyEarnProof",
    "path": "/earn/claims/proof",
    "method": "GET"
  },
  {
    "id": "listActiveEarnActions",
    "path": "/earn/actions",
    "method": "GET"
  },
  {
    "id": "submitEarnContent",
    "path": "/earn/submissions",
    "method": "POST"
  },
  {
    "id": "getEarnLeaderboard",
    "path": "/earn/epochs/{epoch}/leaderboard",
    "method": "GET"
  },
  {
    "id": "getMyEarnSubmissions",
    "path": "/earn/me",
    "method": "GET"
  },
  {
    "id": "getMyEarnClaims",
    "path": "/earn/claims",
    "method": "GET"
  },
  {
    "id": "getMyVault",
    "path": "/vault",
    "method": "GET"
  },
  {
    "id": "getNftVault",
    "path": "/nfts/{id}/vault",
    "method": "GET"
  },
  {
    "id": "getStakePositions",
    "path": "/stake/positions",
    "method": "GET"
  },
  {
    "id": "getFarm",
    "path": "/farms/{id}",
    "method": "GET"
  },
  {
    "id": "getTransaction",
    "path": "/transactions/{id}",
    "method": "GET"
  },
  {
    "id": "listLocalInventories",
    "path": "/collect/inventories",
    "method": "GET"
  },
  {
    "id": "readLocalInventory",
    "path": "/collect/inventories/{id}",
    "method": "GET"
  },
  {
    "id": "readLocalAsset",
    "path": "/collect/assets/{id}",
    "method": "GET"
  },
  {
    "id": "listMyCollectionAssets",
    "path": "/collect/me/assets",
    "method": "GET"
  },
  {
    "id": "listMyCollectionOperations",
    "path": "/collect/me/operations",
    "method": "GET"
  },
  {
    "id": "readMyCollectionOperation",
    "path": "/collect/me/operations/{id}",
    "method": "GET"
  },
  {
    "id": "reserveLocalMint",
    "path": "/collect/inventories/{id}/stages/{stage}/reservations",
    "method": "POST"
  },
  {
    "id": "reserveLocalProgression",
    "path": "/collect/inventories/{id}/progression",
    "method": "POST"
  },
  {
    "id": "quoteLocalProgression",
    "path": "/collect/inventories/{id}/progression/quote",
    "method": "POST"
  },
  {
    "id": "getLocalOperationStatus",
    "path": "/operations/status",
    "method": "GET"
  },
  {
    "id": "getNoticeCapabilities",
    "path": "/notifications/capabilities",
    "method": "GET"
  },
  {
    "id": "getMyNoticePreferences",
    "path": "/notifications/subscriptions",
    "method": "GET"
  },
  {
    "id": "setMyNoticePreferences",
    "path": "/notifications/subscriptions",
    "method": "POST"
  },
  {
    "id": "getMyLocalNotices",
    "path": "/notifications/inbox",
    "method": "GET"
  },
  {
    "id": "getQuoteAvailability",
    "path": "/markets/{id}/quote-status",
    "method": "GET"
  },
  {
    "id": "previewSwapQuote",
    "path": "/quotes",
    "method": "POST"
  }
];

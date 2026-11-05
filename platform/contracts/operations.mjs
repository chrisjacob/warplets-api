// Generated from openapi.json.
export const operations = [
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
  }
];

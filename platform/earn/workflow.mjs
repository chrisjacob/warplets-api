// Compatibility exports for existing offline CLI/tests. Hosted services import
// earn/service.mjs and injected repositories, never this fixture entry point.
export { addCampaign, submitContent, recordReview, finalizeBoard, readLeaderboard,
  recordAllocation, readWalletClaims, readWalletSubmissions, PILOT_BOARD_CAPACITY, EarnError }
  from '../storage/node/earn-workflow.mjs';
export { recordStakeRead } from './fixtures.mjs';

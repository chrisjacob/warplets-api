// Public terms for the PRD 1.2 local validation release.
export const policy = {
  version: 'prd-1.2',
  mode: 'offline-validation',
  chain: 'solana',
  pillars: ['Vault', 'Stake', 'Earn'],
  launch: {
    allocationBps: { liquidity: 8000, earn: 1000, stake: 500, genesisVault: 250, seasonVault: 250 },
    emptySeasonRecipient: 'genesisVault', clock: 'actual-activation', windowSydney: null,
    feeStartBps: 9000, feeFloorBps: 100, feeDecreaseBpsPerSecond: 100,
    campaignDays: 10, maxActive: 10
  },
  vault: { cliffHours: 24, vestHours: 24, mintRestartsVesting: false },
  earn: { board: 'global', maxWinners: 100, maxWalletBudgetBps: 1000,
    maxMultiplierTenths: 100, minimumCorrespondingStakeUsd: '10', claimsExpire: false, appeals: false },
  genesis: { cap: 10000, trancheSize: 1000, ballotHours: 48, noticeHours: 48, choices: ['ASAP','7d','14d','30d'],
    votesPerWallet: 1, mintsPerEligibleWalletPerStage: 1, firstWhitelistPriceSol: '0.1' },
  season: { monthlyCap: 1000, freeStageRequires: 'revealed-genesis-level-1', freeMintsPerEligibleWallet: 1 },
  operations: { targetFirstTestBelowUsd: '10', firstTestPlanningCashPercent: 20, exceptionCeilingUsd: '30',
    reserveGuidelinePercent: 50, recurringMonthlyCeilingUsd: '5' },
  capabilities: { signsTransactions: false, acceptsDeposits: false, offersNftBurn: false }
};

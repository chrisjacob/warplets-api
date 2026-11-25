import {readFileSync} from 'node:fs';

export const register = JSON.parse(readFileSync(new URL('../experiments.json', import.meta.url)));
export const checks = {
  P00: ['poc/poc.test.mjs', 'contracts/capabilities.test.mjs'],
  P01: ['domain/economics/economics.test.mjs', 'transactions/plan-contracts.test.mjs'],
  P02: ['lab/protocol.test.mjs', 'costs/swap-cost-requirements.test.mjs'],
  P03: ['domain/economics/economics.test.mjs', 'storage/economic-plans.test.mjs'],
  P04: ['lab/kamino.test.mjs', 'stake/farms.test.mjs', 'stake/readiness.test.mjs'],
  P05: ['earn/supported-post.test.mjs', 'earn/snapshot.test.mjs', 'earn/settlement-reconciliation.test.mjs', 'claims/recorded-codecs.test.mjs'],
  P06: ['domain/economics/economics.test.mjs', 'compatibility/compatibility.test.mjs', 'claims/recorded-codecs.test.mjs'],
  P07: ['collect/fairness-timing.test.mjs', 'collect/mint-plan.test.mjs', 'collect/mint-recovery.test.mjs', 'collect/fulfillment-plan.test.mjs'],
  P08: ['collect/fairness-progression.test.mjs', 'storage/upgrade-atomic.test.mjs', 'collect/progression-http.test.mjs'],
  P09: ['compatibility/compatibility.test.mjs', 'transactions/plan-contracts.test.mjs'],
  P10: ['transactions/intents.test.mjs', 'transactions/recovery-reads.test.mjs', 'storage/recorded-transaction-outcomes.test.mjs'],
};

// These are individually executable probes, not declarations that the complete
// acceptance criteria in experiments.json have passed.
export const actions = [
  {id:'original', poc:'P01', title:'Create disposable original token', requires:[], description:'Classic SPL mint: 1,000 units, 9 decimals; mint authority revoked, no freeze authority. No official brand or hosted metadata.'},
  {id:'attention', poc:'P01', title:'Create disposable attention token', requires:['original'], description:'Classic SPL mint: 1,000 units, 9 decimals. Pool gets 80%; remaining units stay in the test wallet until allocation checks.'},
  {id:'token-transfer', poc:'P01', title:'Transfer one original token', requires:['original'], recipient:true, description:'Send one disposable token to another browser-wallet address you control. Creates its token account if needed.'},
  {id:'pool', poc:'P02', title:'Create and permanently lock pair', requires:['original','attention'], description:'800 test ATT and one raw original unit. Meteora DAMM v2, quote-token fees, 90%→1% over 89 seconds; activation 60 seconds after chain time. Locked liquidity is not recoverable. This seed tests mechanics, not pricing.'},
  {id:'buy', poc:'P02', title:'Buy test ATT', requires:['pool'], description:'Spend 0.001 disposable original token; exact-input quote with 1% slippage. Wait until activation + 90 seconds. No real SOL is used as swap inventory.'},
  {id:'sell', poc:'P02', title:'Sell test ATT', requires:['buy'], description:'Sell 0.001 disposable ATT with 1% slippage after launch fees settle.'},
  {id:'fees', poc:'P02', title:'Collect available position fees', requires:['sell'], description:'Collect fees while liquidity remains locked; verify finalized token deltas.'},
  {id:'allocation', poc:'P03', title:'Allocate remaining 20% to labelled test accounts', requires:['pool'], description:'Four payer-owned token accounts: Earn 100, Stake 50, permanent NFT 25, Season 25. These are accounting probes, NOT custody vaults or activation of a real campaign.'},
  {id:'distribution', poc:'P05', title:'Create accelerated single-leaf rewards distribution', requires:['original'], description:'Fund one original token for the connected wallet. Test-only 60-second cliff then 60-second linear vesting. This does not establish 24/48-hour policy or social evidence ingestion.'},
  {id:'claim', poc:'P05', title:'Claim vested test reward', requires:['distribution'], repeatable:true, description:'Claim available units with the real single-leaf proof. May run again after more units vest. Wallet-bound, not NFT-bound.'},
  {id:'nft', poc:'P06', title:'Create disposable Core NFT', requires:[], description:'Standalone Core asset with a qa- name and local metadata URI; no hosted image, royalties, collection or claim rights. Creation is a basic ownership probe.'},
  {id:'nft-transfer', poc:'P06', title:'Transfer disposable Core NFT', requires:['nft'], recipient:true, description:'Move this run’s asset to another browser-wallet address you control. Record current-owner change. Does not resolve burn protection or transferable claim custody.'},
];

export function catalogue() {
  return register.experiments.map(poc=>({...poc, checks:checks[poc.id], actions:actions.filter(a=>a.poc===poc.id)}));
}

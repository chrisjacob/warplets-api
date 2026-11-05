import { visualRerollQuote } from '../domain/collections/progression.mjs';

// Ordinary quote terms refer to one unit of the described operation/account.
// Quantity null means the operator must supply the count. Zero means it was explicitly waived.
const line=(id,label,quantity=1,unit='lamport',payer='founder',kind='fee')=>({id,label,quantity,unit,payer,kind});
const rent=(id,label,count=1,payer='founder')=>line(id,label,count,'lamport',payer,'rent');
const usd=(id,label,count=1,payer='founder')=>line(id,label,count,'microUSD',payer);
const nativeReceipt=(id,label,count)=>line(id,label,count,'microUSD','company','receipt');
const multiply=(a,b)=>a==null||b==null?null:a*b;
const scale=(lines,n)=>lines.map(l=>({...l,quantity:multiply(l.quantity,n)}));
const S=(id,name,scope,lines)=>({id,name,scope,lines});

function coreMints(count,payer) {
  return [
    line('coreProtocol','Core protocol fee per asset mint',count,'lamport',payer),
    rent('coreAssetRent','Asset account rent under selected representation',count,payer),
    line('mintRandomness','Committed entropy and fulfillment',count,'lamport',payer),
    line('mintNetwork','Mint signature and priority ceiling',count,'lamport',payer),
    line('mintRetry','Mint retry and failed fulfillment allowance',count,'lamport',payer),
  ];
}
function claims(count,p,includeVault=true) {
  const vaultCount=includeVault?multiply(count,p.vaultClaimsPerUser):0;
  return [
    rent('classicAtaRent','New token accounts',multiply(count,p.freshAtasPerUser),'claimant'),
    line('claimNetwork','Aggregate network/priority fees per claimant batch',count,'lamport','claimant'),
    rent('claimStateRent','Cumulative claim state per claimant batch',count,'claimant'),
    line('claimRetry','Claim retries per claimant batch',count,'lamport','claimant'),
    usd('proofDelivery','Incremental proof hosting and receipts per claimant',count),
    line('coreVaultExec','Three Core Execute calls in one NFT/ATT Vault claim bundle',vaultCount,'lamport','claimant'),
    rent('temporaryVaultTokenAccount','Temporary SPL account funded and closed in one Vault bundle',vaultCount,'claimant'),
    rent('claimLookupSetup','Verified lookup-table setup/extension allocation for Vault claims',
      includeVault?p.vaultLookupSetups:0),
  ];
}
export function scenarioCatalog(p) {
  const manual=[
    rent('mintRent','ATT mint account'),rent('poolPositionRent','Pool and locked LP-position accounts'),
    rent('reserveSetupRent','Earn, Stake and Vault reserve accounts, excluding farm and user accounts'),
    line('launchProtocol','Launch protocol charges'),line('launchNetwork','Compiled launch message fees and priority ceiling'),
    line('launchRetry','Maximum attributable launch retries'),line('ogSeed','OG initializer seed',1,'ogRaw'),
  ];
  const farm=[rent('farmStateRent','Kamino FarmState'),rent('farmVaultRent','Farm reward/principal vault rent'),
    line('farmFundNetwork','Farm create, funding and priority fees'),line('farmRetry','Farm failure/retry allowance')];
  const earn=[line('earnRootNetwork','Record a token root and fund its allocation'),rent('earnRootRent','Root/distributor state per token'),
    line('earnRootRetry','Root/funding retry allowance'),usd('earnManifestHost','Manifest persistence per token/epoch')];
  const vault=[rent('vaultPooledCustody','Incremental pooled custody per ATT outside launch reserve setup'),
    rent('vaultCheckpointRent','Compact Genesis/Season snapshot state per launch'),line('vaultNetwork','Snapshot funding and fees'),
    line('vaultRetry','Vault retry allowance'),usd('vaultProofStorage','Durable proof export and indexed history')];
  const mintSetup=[rent('collectionSetup','One-time collection, reserve and draw setup'),
    line('collectionNetwork','Collection setup network/priority fees and retries')];
  const opsDaily=[usd('marketRefresh','Daily incremental market reads per active campaign',10),
    usd('farmIndex','Daily incremental farm indexing per active campaign',10),
    usd('dailyMonitor','Daily incremental monitoring usage')];
  const recurring=[usd('recurringCompute','New monthly compute / API through existing plan'),
    usd('recurringStorage','New monthly DB, backups and object storage'),usd('recurringData','New monthly RPC/indexer base plan')];
  const founderInventory=p.unsoldFounderMints;
  const opFees=[];
  if (p.upgradeCount!==0) {
    opFees.push({...line('upgradeProduct','Upgrade product fee: 0.01 × starting Level SOL',p.upgradeCount,'lamport','collector','product fee'),
      formulaAmount:p.upgradeLevel==null?null:String(10_000_000n*BigInt(p.upgradeLevel))});
  }
  if (p.rerollCount!==0) {
    opFees.push({...line('rerollProduct','Visual reroll fee at the recorded prior reroll count',p.rerollCount,'lamport','collector','product fee'),
      formulaAmount:p.priorRerolls==null?null:String(visualRerollQuote(p.priorRerolls,0).feeLamports)});
  }
  const opCount=p.upgradeCount==null||p.rerollCount==null?null:p.upgradeCount+p.rerollCount;
  return [
    S(1,'Manual ATT launch','One base market setup. Combine disjoint farm/distributor/Vault lines for the complete first ATT.',manual),
    S(2,'One ten-day farm','One farm plus the example of a participating staker. Five percent of original ATT is funded supply, not a founder SOL cost.',
      [...farm,rent('farmUserRent','UserState per new participating staker',p.newStakers,'staker'),
        line('farmUserNetwork','User interaction fees per participating staker',p.newStakers,'lamport','staker')]),
    S(3,'Ten active campaigns','One incremental new market and farm plus one day of upkeep for ten active campaigns.',
      [...manual,...farm,...opsDaily]),
    S(4,'One Earn board across ten tokens','Ten compact roots; up to 100 winners × ten token awards. Claim costs arise when participants claim.',
      [...scale(earn,10),...claims(p.dailyClaimants,p,false)]),
    S(5,'Vault per launch','One pooled reserve/checkpoint. The entitlement design must include all unminted slots.',vault),
    ...[100,1000,10000].map((n,i)=>S(6+i,`Claims for ${n.toLocaleString('en-US')} users`,'Claimant-funded accounts and batch costs; separate proof hosting.',claims(n,p))),
    S(9,'Lazy Genesis mint','Reserve setup plus one buyer mint in the first Genesis whitelist phase. Inventory stays lazy.',
      [...mintSetup,...coreMints(1,'minter'),{...line('firstWhitelistPrice','First whitelist purchase price',1,'lamport','minter','product fee'),formulaAmount:'100000000'}]),
    S(10,'Genesis tranche of 1,000','Creation of 1,000 buyer-funded assets. Aggregate purchase prices depend on the actual stage schedule.',
      [...coreMints(1000,'minter'),line('tranchePurchaseTotal','Sum of paid stage prices across the tranche',1,'lamport','minter','product fee')]),
    S(11,'Season with 1,000 reserved slots','One reserve and allocations for paid, free and founder mints. Unissued slots have zero mint transactions.',
      [...mintSetup,...coreMints(p.seasonPaid,'minter'),line('seasonPaidPrice','Paid Season price',p.seasonPaid,'lamport','minter','product fee'),
        ...coreMints(p.seasonFree,'free claimant'),...coreMints(p.seasonFounder,'founder')]),
    S(12,'Season upgrade and reroll','Product fee is charged separately from randomness, metadata and retries. A paid product fee is not profit.',
      [...opFees,line('progressRandomness','Random draw and fulfillment',opCount,'lamport','collector'),
        line('progressMetadata','Metadata updates and ownership validation',opCount,'lamport','collector'),
        line('progressNetwork','Transaction and retry ceiling',opCount,'lamport','collector'),
        usd('supportReserve','Refund/support provision per paid action',opCount)]),
    S(13,'Founder mints unsold inventory','No sale receipts. Founder pays full creation costs and separately approves a backstop amount.',
      coreMints(founderInventory,'founder')),
    S(14,'Thirty-day operating outcomes','Thirty new market/farm starts with ten active campaigns; 300 token roots, 30 Vault checkpoints. Steady-state scenario, not a demand forecast.',
      [...scale([...manual,...farm,...vault,...opsDaily],30),...scale(earn,300),...recurring,
        usd('moderationSupport','Monthly staffed moderation/support provision'),usd('distributionUsage','Monthly incremental distribution usage beyond included base plans'),
        nativeReceipt('realizedMintReceipts','Realized monthly company mint receipts',1),
        nativeReceipt('realizedFeeReceipts','Realized monthly collectible market fees',1)]),
  ];
}

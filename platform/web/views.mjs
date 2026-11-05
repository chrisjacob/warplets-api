/** All amounts, ranks and campaign schedules come from the versioned API. */
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const e = escapeHtml;
const fmt = new Intl.NumberFormat('en-US');
export const percent = bps => typeof bps === 'number' && Number.isFinite(bps)
  ? fmt.format(bps / 100) + '%' : 'Unavailable';
const number = v => Number.isFinite(v) ? fmt.format(v) : 'Unavailable';
const metric = (label,value,detail='') => '<div class="metric"><span>'+e(label)+'</span><strong>'+e(value)
  +'</strong>'+(detail?'<small>'+e(detail)+'</small>':'')+'</div>';
const intro = (title,description) => '<section class="intro"><h1>'+e(title)+'</h1><p>'+e(description)+'</p></section>';
const card = (title,body) => '<section class="card"><h2>'+e(title)+'</h2>'+body+'</section>';
const unavailable = (message) => '<p class="notice" role="status">'+e(message)+'</p>';
const statGrid = html => '<div class="metrics">'+html+'</div>';
export const compactAddress = wallet => [...wallet].length <= 16 ? wallet : wallet.slice(0,6)+'…'+wallet.slice(-6);

function allocation(policy) {
  const rows = Object.entries(policy.launch.allocationBps);
  const labels = { liquidity:'Pool liquidity', earn:'Earn rewards', stake:'Staking rewards',
    genesisVault:'Genesis Vault', seasonVault:'Season Vault' };
  const colors = ['#b5da4e','#5f9768','#335548','#577e93','#777bab'];
  let start = 0;
  const bars = rows.map(([,bps],i) => {
    const x = start; start += bps;
    return '<rect x="'+Number(x)+'" y="0" width="'+Number(bps)+'" height="100" fill="'+colors[i%5]+'"/>';
  });
  return card('Launch allocation', '<svg class="allocation-bar" viewBox="0 0 10000 100" preserveAspectRatio="none" aria-hidden="true">'
    +bars.join('')+'</svg><dl class="breakdown">'+rows.map(([key,bps],i) => '<div><dt><b class="dot dot-'+i+'"></b>'
      +e(labels[key] ?? key)+'</dt><dd>'+percent(bps)+'</dd></div>').join('')+'</dl>');
}

function validCurve(points) {
  return Array.isArray(points) && points.length >= 2 && points.every((p,i) =>
    Number.isSafeInteger(p.elapsedSeconds) && p.elapsedSeconds >= 0 && (i===0 || p.elapsedSeconds > points[i-1].elapsedSeconds)
    && Number.isInteger(p.feeBps) && p.feeBps >= 0 && p.feeBps <= 10000);
}

/** Draw a presentation of the returned series; interpolation never prices a transaction. */
export function feeChart(schedule, selectedIndex=0) {
  const points=schedule?.points;
  if (!validCurve(points)) return card('Opening fee schedule', unavailable('The launch fee schedule is unavailable.'));
  const selected=points[selectedIndex] ?? points[0],first=points[0],last=points.at(-1);
  const ceiling=Math.max(...points.map(p=>p.feeBps),1);
  const xy=p=>[32+426*(p.elapsedSeconds-first.elapsedSeconds)/(last.elapsedSeconds-first.elapsedSeconds),
    114-96*p.feeBps/ceiling];
  const coords=points.map(p=>xy(p).map(n=>n.toFixed(2)).join(','));
  const [cx,cy]=xy(selected);
  return '<section class="curve"><div class="curve-head"><div><h2>Opening fee schedule</h2>'
    +'<p>Elapsed time from market activation</p></div><span class="curve-value" id="curve-value">'+percent(selected.feeBps)+'</span></div>'
    +'<svg class="curve-plot" role="img" aria-label="Opening fee falls from '+percent(first.feeBps)+' to '+percent(last.feeBps)
    +'" viewBox="0 0 490 140"><path d="M32 18H458M32 66H458M32 114H458" class="grid-line"/>'
    +'<polygon points="32,114 '+coords.join(' ')+' 458,114" class="chart-fill"/><polyline points="'+coords.join(' ')+'" class="chart-line"/>'
    +'<circle id="curve-marker" cx="'+cx+'" cy="'+cy+'" r="5.5"/><text x="32" y="135">'+first.elapsedSeconds+'s</text>'
    +'<text x="458" y="135" text-anchor="end">'+last.elapsedSeconds+'s</text></svg>'
    +'<div class="range"><label for="curve-seconds">Explore the schedule <output id="curve-time">'+selected.elapsedSeconds+' seconds</output></label>'
    +'<input type="range" id="curve-seconds" min="0" max="'+(points.length-1)+'" value="'+selectedIndex+'" aria-valuetext="'+selected.elapsedSeconds+' seconds, '+percent(selected.feeBps)+' fee"></div></section>';
}

function marketDirectory(markets,selectedId) {
  if (!markets) return card('Campaigns',unavailable('Market data is unavailable. Reload to try again.'));
  const items=markets.items ?? [];
  if (!items.length) return card('Campaigns', '<div class="empty"><h3>No markets yet</h3>'
    +'<p>Curated ATT/OG pairs appear here once a campaign opens.</p></div>');
  const selected=items.find(m=>m.id===selectedId);
  const list='<ul class="market-list">'+items.map(item=>'<li><a href="/markets?market='+encodeURIComponent(item.id)+'">'
    +'<strong>'+e(item.symbol)+' <small>/ '+e(item.ogSymbol)+'</small></strong><span>'+e(item.source==='local-fixture'?'Local fixture':item.status)
    +' <span aria-hidden="true">↗</span></span></a></li>').join('')+'</ul>';
  const details=selected?card(e(selected.symbol)+' market details','<dl class="breakdown addresses">'
    +[['Paired OG',selected.ogSymbol],['Opening fee now',percent(selected.feeBps)],['ATT mint',selected.attMint],['OG mint',selected.ogMint],['Pool',selected.poolAddress]].map(([a,b])=>
      '<div><dt>'+e(a)+'</dt><dd>'+e(b)+'</dd></div>').join('')+'</dl><a href="/markets">All campaigns</a>'):'';
  return card('Campaigns',list)+details;
}

export function marketsView({policy,markets,schedule,selectedId}) {
  return intro('Markets','Explore curated Solana attention tokens and the original tokens they pair with.')
    +'<div class="market-grid">'+feeChart(schedule)+allocation(policy)+'</div>'+marketDirectory(markets,selectedId);
}

export function vaultView({policy,me}) {
  const {vault,launch}=policy;
  return intro('Vault','Genesis and active Season NFTs accrue a share of each ATT launch.')
    +statGrid(metric('Genesis allocation',percent(launch.allocationBps.genesisVault),'of each launch')
      +metric('Season allocation',percent(launch.allocationBps.seasonVault),'while Season weight is active')
      +metric('Vesting period',number(vault.vestHours)+'h','after a '+number(vault.cliffHours)+'h cliff'))
    +'<div class="two-up">'+card('How claims vest','<ol class="timeline"><li><strong>Launch</strong><p>Allocations follow each NFT’s Level, including reserved unminted slots.</p></li>'
      +'<li><strong>After '+number(vault.cliffHours)+' hours</strong><p>The allocation begins to vest continuously.</p></li>'
      +'<li><strong>After '+number(vault.cliffHours+vault.vestHours)+' hours</strong><p>The full allocation is vested. A buyer inherits the remaining claim.</p></li></ol>')
    +card('Permanent claims','<p>The original vesting clock follows the allocation. Selling an NFT transfers its remaining Vault entitlement.</p>'
      +'<a class="text-link" href="/collect">Explore collections ↗</a>')+'</div>';
}

export function stakeView({policy,markets}) {
  return intro('Stake','Stake an ATT during its campaign to earn rewards in that same token.')
    +statGrid(metric('Farm funding',percent(policy.launch.allocationBps.stake),'of original ATT supply')
      +metric('Campaign length',number(policy.launch.campaignDays)+' days','from actual activation')
      +metric('Accrual','Continuous','while the position is staked'));
}

export function earnView({policy,board,date}) {
  const earn=policy.earn;
  let table;
  if (!board) table=unavailable('The leaderboard is unavailable. Choose another date or retry.');
  else if (board.status !== 'final') table='<div class="empty"><h3>Awaiting final scores</h3><p>This UTC board has yet to be finalized.</p></div>';
  else if (!board.items.length) table='<div class="empty"><h3>Final board · no winners</h3><p>No eligible contribution placed on this board.</p></div>';
  else table='<div class="table-scroll"><table><caption>Final leaderboard · '+e(date)+' UTC</caption><thead><tr><th>Rank</th><th>Wallet</th><th>Score</th><th>Multiplier</th><th>Points</th></tr></thead><tbody>'
    +board.items.map(row=>'<tr><td>'+e(row.rank)+'</td><td><abbr title="'+e(row.wallet)+'">'+e(compactAddress(row.wallet))+'</abbr></td><td>'+e(row.contentScore)
      +'</td><td>'+e(row.multiplierTenths/10)+'×</td><td>'+e(row.pointsTenths/10)+'</td></tr>').join('')+'</tbody></table></div>';
  return intro('Earn','Compete on one global daily board with your highest-scoring eligible contribution.')
    +statGrid(metric('Winner places','Top '+number(earn.maxWinners),'across all active campaigns')
      +metric('Stake requirement','US$'+earn.minimumCorrespondingStakeUsd,'in the corresponding ATT')
      +metric('Maximum multiplier',number(earn.maxMultiplierTenths/10)+'×','applied to the content score'))
    +card('Daily leaderboard','<form method="get" action="/earn" class="date-form"><label for="board-date">Board date (UTC)</label><input id="board-date" type="date" name="date" value="'+e(date)+'" required><button type="submit">View board</button></form>'+table);
}

export function collectView({collections}) {
  const items=collections?.items ?? [];
  const genesis=items.find(row=>row.id==='genesis'),season=items.find(row=>row.id==='seasons');
  const heading=intro('Collect','Explore permanent Genesis membership and monthly Season collections.');
  if (!genesis || !season) return heading+unavailable('Collection terms are unavailable. Reload to try again.');
  const specs=pairs=>'<dl class="breakdown">'+pairs.map(([label,value])=>'<div><dt>'+e(label)+'</dt><dd>'+e(value)+'</dd></div>').join('')+'</dl>';
  return heading+'<div class="two-up collections">'
    +'<section class="card collection"><div class="collection-mark genesis-mark" aria-hidden="true">G<span>/</span></div><h2>Genesis</h2>'
    +'<p>Permanent Vault eligibility with an immutable Level from 1 to 10.</p>'
    +specs([['Maximum supply',number(genesis.cap)],['Per tranche',number(genesis.trancheSize)],['First whitelist price',genesis.firstWhitelistPriceSol+' SOL'],['Eligible wallet',genesis.mintsPerEligibleWalletPerStage+' mint per stage']])
    +'<details><summary>Tranche voting</summary><p>Holder and next-tranche whitelist wallets get '+e(genesis.votesPerWallet)+' vote each. The advisory ballot lasts '+e(genesis.ballotHours)+' hours.</p><p>Timing choices: '+e(genesis.choices.join(' · '))+'.</p></details></section>'
    +'<section class="card collection"><div class="collection-mark season-mark" aria-hidden="true">S<span>/</span></div><h2>Seasons</h2>'
    +'<p>Benefit duration follows the current Level, measured from the published Season start.</p>'
    +specs([['Monthly supply',number(season.monthlyCap)],['Free stage','Revealed Genesis 1X'],['Eligible wallet',season.freeMintsPerEligibleWallet+' free mint']])
    +'<details><summary>Upgrades and visual rerolls</summary><p>Pair two same-Level NFTs from the same Season to raise one NFT’s Level. The other receives a new Level draw. Visual rerolls change Model, Backdrop and Symbol together.</p></details></section></div>';
}

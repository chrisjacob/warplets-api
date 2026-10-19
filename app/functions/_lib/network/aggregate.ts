import { NETWORK_METHODOLOGY, type NetworkCell, type NetworkDashboard, type NetworkFilters, type NetworkRow, type NetworkSnapshot, type NetworkVote } from '../../../shared/network/model';
import { networkManMonths } from '../../../shared/network/activity';
const votes: NetworkVote[] = ['opted_in', 'opted_out', 'pending', 'moderated_out', 'unavailable'];
const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
const name = (code: string) => code === 'UNKNOWN' ? 'Unknown location' : code === 'UNAVAILABLE' ? 'Profiles not yet observed' : countryNames.of(code) ?? code;
const countryId = (c: NetworkCell) => c.location === 'unavailable' ? 'UNAVAILABLE' : c.country ?? 'UNKNOWN';
const tokenId = (c: NetworkCell) => c.tokenStatus === 'assigned' ? c.token! : c.tokenStatus === 'none' ? 'none' : 'unavailable';
const sum = (cells: NetworkCell[]) => cells.reduce((s, c) => s + c.count, 0);

export function buildNetworkDashboard(snapshot: NetworkSnapshot | null, filters: NetworkFilters): NetworkDashboard {
  const all = snapshot?.cells ?? [];
  const selectedTokens = new Set(filters.tokens);
  const state = filters.state ?? 'all', city = filters.city ?? 'all';
  const level = /^[A-Z]{2}$/.test(filters.country) ? state !== 'all' && state !== 'UNKNOWN' ? 'city' : 'state' : 'country';
  const places = new Map([...(snapshot?.geography?.states ?? []),...(snapshot?.geography?.cities ?? [])].map(p=>[p.id,p]));
  const cells = all.filter(c => (filters.country === 'all' || countryId(c) === filters.country)
    && (state === 'all' || (c.state ?? 'UNKNOWN') === state)
    && (city === 'all' || (c.city ?? 'UNKNOWN') === city)
    && (filters.location === 'all' || c.location === filters.location)
    && (filters.vote === 'all' || c.vote === filters.vote)
    && (!selectedTokens.size || selectedTokens.has(tokenId(c)))
    && (filters.warplet!=='holders'||c.warpletHolder===true)
    && (!filters.held || filters.held==='all' || (c.held??'unavailable')===filters.held));
  const total = sum(cells), parentTotal = sum(all);
  // Public profile counts are visible at every group size. Wallet publication
  // follows its own attribution and coverage rules.
  const suppressed = false;
  const protect = (n: number) => !snapshot || suppressed ? null : n;
  const parts = (values: number[]) => values;
  // Public profile counts are not subject to financial publication thresholds.
  const locations = parts(['known', 'unknown', 'unavailable'].map(location => sum(cells.filter(c => c.location === location))));
  const affiliations = parts(['assigned', 'none', 'unavailable'].map(status => sum(cells.filter(c => c.tokenStatus === status))));
  const statusCounts = parts(votes.map(vote => sum(cells.filter(c => c.vote === vote))));
  const tokenCatalog = new Map(snapshot?.tokens.map(token => [token.id, token]) ?? []);
  const heldCatalog=new Map(snapshot?.wallet?.tokens.map(token=>[token.id,token])??[]);
  function rows(type: 'country' | 'token' | 'held' | 'state' | 'city'): NetworkRow[] {
    const grouped = new Map<string, { population: number; adoption: number; usd:bigint }>();
    for (const cell of cells) {
      const id = type === 'country' ? countryId(cell) : type === 'state' ? cell.state ?? 'UNKNOWN' : type === 'city' ? cell.city ?? 'UNKNOWN' : type==='held'?cell.held??'unavailable':tokenId(cell);
      const row = grouped.get(id) ?? { population: 0, adoption: 0, usd:0n };
      row.population += cell.count;
      row.usd+=BigInt(cell.walletUsdUnits??'0');
      if (cell.vote === 'opted_in') row.adoption += cell.count;
      grouped.set(id, row);
    }
    return [...grouped].map(([id, { population, adoption, usd }]) => {
      const token = (type==='held'?heldCatalog:tokenCatalog).get(id);
      return { id, name: type === 'country' ? name(id) : type === 'state' || type === 'city' ? places.get(id)?.name ?? (type === 'state' ? 'State unknown' : 'City unknown') : id === 'none' ? type==='held'?'No positive priced holding':'No profile token (cleared)' : id === 'unavailable' ? type==='held'?'Wallet measurement pending':'Token field not supplied' : id==='ambiguous'?'Shared wallet attribution':id==='unpriced'?'Only unpriced holdings':token?.symbol ? `${token.symbol} · ${token.name}` : token?.name ?? id,
        population, adoption, percentage: population !== null && total ? population / total * 100 : null, suppressed: population === null, walletUsd:snapshot?.wallet?money(usd):undefined };
    }).sort((a, b) => (b.population ?? -1) - (a.population ?? -1) || a.name.localeCompare(b.name));
  }
  let cumulative = 0;
  const days = new Map<string, number>();
  for (const cell of cells) if (cell.acceptedDay !== null) days.set(cell.acceptedDay, (days.get(cell.acceptedDay) ?? 0) + cell.count);
  const adoption = [...days.keys()].sort().map(day => { cumulative += days.get(day)!; return { day, count: cumulative }; });
  const money=(units:bigint)=>`${units/100_000_000n}.${(units%100_000_000n).toString().padStart(8,'0')}`;
  const attributable=cells.reduce((sum,cell)=>sum+BigInt(cell.walletUsdUnits??'0'),0n);
  const global=filters.warplet!=='holders'&&state==='all'&&city==='all'&&filters.country==='all'&&filters.location==='all'&&filters.vote==='all'&&!filters.tokens.length&&(!filters.held||filters.held==='all');
  const unallocated=global?BigInt(snapshot?.wallet?.unallocatedUsdUnits??'0'):0n;
  const portfolios=cells.flatMap(cell=>cell.portfolioValues??[]).map(value=>BigInt(value)).sort((a,b)=>a===b?0:a<b?-1:1);
  const completedSum=portfolios.reduce((sum,value)=>sum+value,0n);
  const median=portfolios.length?portfolios.length%2?portfolios[Math.floor(portfolios.length/2)]:(portfolios[portfolios.length/2-1]+portfolios[portfolios.length/2])/2n:null;
  return {
    snapshot: snapshot ? { id: snapshot.id, createdAt: snapshot.createdAt, profileOldestAt: snapshot.profileOldestAt,
      stale: snapshot.createdAt < Date.now() - 30 * 60_000 || Boolean(snapshot.profileOldestAt && snapshot.profileOldestAt < Date.now() - 30 * 3_600_000), scan: snapshot.scan, sources: snapshot.sources } : null,
    filters, population: snapshot ? protect(total) : null, cohortPopulation: snapshot ? parentTotal : null,
    coverage: { observed: protect(total - sum(cells.filter(c => c.location === 'unavailable'))), known: !snapshot || suppressed ? null : locations[0], unknown: !snapshot || suppressed ? null : locations[1], unavailable: !snapshot || suppressed ? null : locations[2], tokenAssigned: !snapshot || suppressed ? null : affiliations[0], tokenUnavailable: !snapshot || suppressed ? null : affiliations[2] },
    votes: votes.map((id, i) => ({ id, count: !snapshot || suppressed ? null : statusCounts[i] })), countries: rows('country'), tokens: rows('token'),
    geography: {level,mapped:protect(sum(cells.filter(c=>level==='country'?Boolean(c.country):level==='state'?Boolean(c.state):Boolean(c.city)))),unmapped:protect(sum(cells.filter(c=>level==='country'?!c.country:level==='state'?!c.state:!c.city))),rows:rows(level),states:(snapshot?.geography?.states??[]).filter(p=>p.country===filters.country),cities:(snapshot?.geography?.cities??[]).filter(p=>p.country===filters.country&&p.state===state)},
    countryCatalog:[...new Set(all.map(countryId))].map(id=>({id,name:name(id)})).sort((a,b)=>a.name.localeCompare(b.name)),
    tokenCatalog: snapshot?.tokens ?? [], adoption: suppressed ? [] : adoption, suppressed,
    warplets:snapshot?.warplets,
    heldTokens:rows('held'),heldCatalog:snapshot?.wallet?.tokens??[],
    economics: snapshot?.wallet?.measuredWallets ? {status:snapshot.wallet.measuredWallets===snapshot.wallet.expectedWallets&&snapshot.wallet.associationsObserved===snapshot.population?'ready':'partial',chain:'Base',reason:'Observable Base native and fungible assets in verified EVM wallets, independently priced by DefiLlama. Unpriced/low-confidence assets, NFTs, DeFi positions and liabilities are excluded. Shared wallets count once globally and remain unallocated.',totalUsd:money(attributable+unallocated),attributedUsd:money(attributable),unallocatedUsd:money(unallocated),averageUsd:portfolios.length?money(completedSum/BigInt(portfolios.length)):null,medianUsd:median===null?null:money(median),measuredAccounts:portfolios.length,coverage:snapshot.wallet,stale:Boolean(snapshot.wallet.oldestBalanceAt&&snapshot.wallet.oldestBalanceAt<Date.now()-Math.max(36,(snapshot.wallet.balanceRefreshHours??24)*1.5)*3_600_000||snapshot.wallet.oldestPriceAt&&snapshot.wallet.oldestPriceAt<Date.now()-7_200_000)} : { status: 'unavailable', chain: 'Base', reason: 'Verified-wallet import is pending. No missing balance is treated as zero.',coverage:snapshot?.wallet },
    manMonths: networkManMonths(cells, snapshot?.createdAt ?? Date.now(), Boolean(snapshot)),
    activity: { status: 'unavailable', reason: 'Complete 30-day cast, reaction and follow coverage has not been imported for this cohort.' },
    methodology: NETWORK_METHODOLOGY,
  };
}

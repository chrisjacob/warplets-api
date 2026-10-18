// Investigation helpers only. No sample result is suitable for public totals.
export const BASE_ASSETS = new Map([
  ['0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', { symbol: 'ETH', decimals: 18 }],
  ['0x0000000000000000000000000000000000000000', { symbol: 'ETH', decimals: 18 }],
  ['0x4200000000000000000000000000000000000006', { symbol: 'WETH', decimals: 18 }],
  ['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', { symbol: 'USDC', decimals: 6 }],
  ['0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf', { symbol: 'cbBTC', decimals: 8 }],
]);

export const ISO_COUNTRIES = new Set('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' '));
const regionNames = new Map();
for (const style of ['long', 'short']) {
  const names = new Intl.DisplayNames(['en'], { type: 'region', style });
  for (const code of ISO_COUNTRIES) regionNames.set(names.of(code).toLowerCase(), code);
}
for (const [name, code] of [['usa', 'US'], ['u.s.a.', 'US'], ['u.s.', 'US'], ['uk', 'GB'], ['u.k.', 'GB'], ['south korea', 'KR'], ['north korea', 'KP']]) regionNames.set(name, code);

export function countryFromDescription(description) {
  if (typeof description !== 'string') return null;
  const tail = description.split(',').at(-1).trim();
  // A city alone is insufficient. Match only an explicit country name/ISO code.
  return regionNames.get(tail.toLowerCase()) ?? (ISO_COUNTRIES.has(tail) ? tail : null);
}

export function officialProfile(payload, expectedFid) {
  const user = payload?.result?.user;
  if (user?.fid !== expectedFid || !user.profile || typeof user.profile !== 'object') return null;
  const rawToken = user.profile.profileToken?.tokenUri;
  return {
    fid: user.fid,
    country: countryFromDescription(user.profile.location?.description),
    locationReturned: Boolean(user.profile.location?.description),
    voteStatus: ['opted_in', 'opted_out', 'pending', 'moderated_out'].includes(user.viewerContext?.optInStatus) ? user.viewerContext.optInStatus : 'unavailable',
    tokenStatus: rawToken === undefined ? 'not_returned' : rawToken === '' ? 'none' : canonicalToken(rawToken) ? 'assigned' : 'invalid',
    token: canonicalToken(rawToken),
  };
}

export function wallet(value) {
  return typeof value === 'string' && /^0x[\da-f]{40}$/i.test(value) ? value.toLowerCase() : null;
}

export function country(user) {
  const value = user?.profile?.location?.address?.country_code;
  // Validate explicit ISO codes rather than guessing from profile biographies.
  return typeof value === 'string' && ISO_COUNTRIES.has(value) ? value : null;
}

export function canonicalToken(value) {
  if (typeof value !== 'string') return null;
  const evm = value.match(/^eip155:([1-9]\d*)\/erc20:(0x[\da-fA-F]{40})$/);
  if (evm) return `eip155:${evm[1]}/erc20:${evm[2].toLowerCase()}`;
  if (/^solana:[1-9A-HJ-NP-Za-km-z]{1,64}\/token:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return value;
  if (/^(eip155:[1-9]\d*|solana:[1-9A-HJ-NP-Za-km-z]{1,64})\/slip44:\d+$/.test(value)) return value;
  return null;
}

export function tokenObservation(payload) {
  if (!Array.isArray(payload?.messages) || typeof payload.nextPageToken !== 'string' || payload.nextPageToken) {
    return { status: 'unavailable', asset: null };
  }
  const records = payload.messages.filter(m => [13, 'USER_DATA_TYPE_PROFILE_TOKEN'].includes(m?.data?.userDataBody?.type));
  if (!records.length) return { status: 'not_observed', asset: null };
  const ordered = [...records].sort((a, b) => b.data.timestamp - a.data.timestamp);
  const value = ordered[0].data.userDataBody.value;
  if (value === '') return { status: 'none', asset: null };
  const asset = canonicalToken(value);
  return { status: asset ? 'assigned' : 'invalid', asset };
}

// Fixed-point USD precision: 8 decimals. Token quantities never pass through Number.
export function decimalUnits(value, precision = 8) {
  if (typeof value !== 'string' || value.length > 100 || !/^\d+(\.\d+)?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10n ** BigInt(precision) + BigInt((fraction + '0'.repeat(precision)).slice(0, precision));
}

export function inspectBalance(row) {
  if (row?.network !== 'base') return { status: 'wrong_chain', usd: 0n };
  const asset = BASE_ASSETS.get(wallet(row.address));
  if (!asset) return { status: 'unsupported', usd: 0n };
  if (row.decimals !== asset.decimals || typeof row.balance !== 'string' || !/^\d{1,80}$/.test(row.balance)) {
    return { status: 'invalid', usd: 0n };
  }
  const price = decimalUnits(row.price_usd);
  if (price === null || price <= 0n) return { status: 'unpriced', usd: 0n };
  return { status: 'priced', usd: BigInt(row.balance) * price / 10n ** BigInt(asset.decimals) };
}

export function portfolio(rows, complete) {
  // Partial pagination and failed requests must never become measured portfolios.
  if (!complete) return { status: 'unavailable', usd: null, exclusions: {} };
  const seen = new Set();
  let usd = 0n;
  const exclusions = {};
  for (const row of rows) {
    const id = `${row.network}:${wallet(row.address) ?? String(row.address)}`;
    if (seen.has(id)) return { status: 'unavailable', usd: null, exclusions: { duplicate_asset: 1 } };
    seen.add(id);
    const result = inspectBalance(row);
    if (result.status === 'priced') usd += result.usd;
    else exclusions[result.status] = (exclusions[result.status] ?? 0) + 1;
  }
  return { status: 'observed', usd, exclusions };
}

export function walletOwners(users) {
  const owners = new Map();
  for (const user of users) {
    for (const raw of user.verified_addresses?.eth_addresses ?? []) {
      const address = wallet(raw);
      if (!address) continue;
      const fids = owners.get(address) ?? new Set();
      fids.add(user.fid);
      owners.set(address, fids);
    }
  }
  return owners;
}

export function estimateCalls(population, walletCount, batchSize = 100, pagesPerWallet = 1) {
  if (![population, walletCount, batchSize, pagesPerWallet].every(Number.isSafeInteger) || population < 0 || walletCount < 0 || batchSize < 1 || pagesPerWallet < 1) throw new Error('Invalid estimate inputs');
  return {
    hydratedProfileSweep: Math.ceil(population / batchSize),
    perFidTokenSweep: population,
    hourlyPerFidTokenCallsPer30Days: population * 24 * 30,
    dailyWalletCallsPer30Days: walletCount * pagesPerWallet * 30,
  };
}

export function reconcileCountries(users) {
  const fids = new Set();
  const countries = {};
  let unknown = 0;
  for (const user of users) {
    if (!Number.isSafeInteger(user.fid) || user.fid < 1 || fids.has(user.fid)) throw new Error('Invalid or duplicate FID');
    fids.add(user.fid);
    const code = country(user);
    if (code) countries[code] = (countries[code] ?? 0) + 1;
    else unknown++;
  }
  return { samplePopulation: fids.size, known: fids.size - unknown, unknown, countries };
}

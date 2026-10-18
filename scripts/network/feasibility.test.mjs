import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalToken, tokenObservation, portfolio, walletOwners, reconcileCountries, estimateCalls, countryFromDescription, officialProfile, country } from './feasibility-lib.mjs';

const usdc = (balance = '1000000') => ({ network: 'base', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6, balance, price_usd: '1' });
test('quantities retain precision and provider USD values without prices are excluded', () => {
  assert.equal(portfolio([usdc('123456789123456789123456789')], true).usd, 12345678912345678912345678900n);
  const p = portfolio([{ ...usdc(), price_usd: null, balance_usd: '9999' }], true);
  assert.equal(p.usd, 0n);
  assert.deepEqual(p.exclusions, { unpriced: 1 });
});
test('failed/partial portfolios differ from observed empty portfolios', () => {
  assert.equal(portfolio([], false).usd, null);
  assert.equal(portfolio([], true).usd, 0n);
  assert.equal(portfolio([usdc(), usdc()], true).status, 'unavailable');
  assert.deepEqual(portfolio([{ ...usdc(), network: 'ethereum' }], true).exclusions, { wrong_chain: 1 });
});
test('token observation does not turn unsupported/missing retrieval into no token', () => {
  assert.equal(tokenObservation({ messages: [] }).status, 'unavailable');
  assert.equal(tokenObservation({ messages: [], nextPageToken: '' }).status, 'not_observed');
  assert.equal(tokenObservation({ messages: [], nextPageToken: 'next' }).status, 'unavailable');
  const message = (value, timestamp) => ({ data: { timestamp, userDataBody: { type: 13, value } } });
  assert.equal(tokenObservation({ messages: [message('eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 1), message('', 2)], nextPageToken: '' }).status, 'none');
  assert.equal(canonicalToken('USDC'), null);
  assert.equal(canonicalToken('eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'), 'eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
});
test('wallet association preserves ambiguity and deduplicates within FID', () => {
  const address = usdc().address;
  const owners = walletOwners([{ fid: 1, verified_addresses: { eth_addresses: [address, address.toLowerCase()] } }, { fid: 2, verified_addresses: { eth_addresses: [address] } }]);
  assert.equal(owners.size, 1);
  assert.equal([...owners.values()][0].size, 2);
});
test('country sample reconciles and refuses duplicate identities or invalid codes', () => {
  const result = reconcileCountries([{ fid: 1, profile: { location: { address: { country_code: 'AU' } } } }, { fid: 2, profile: { location: { address: { country_code: 'XX' } } } }, { fid: 3 }]);
  assert.equal(result.known + result.unknown, result.samplePopulation);
  assert.deepEqual(result.countries, { AU: 1 });
  assert.throws(() => reconcileCountries([{ fid: 1 }, { fid: 1 }]));
});
test('scale estimates are call counts, never invented credit costs', () => {
  assert.deepEqual(estimateCalls(3355055, 100), { hydratedProfileSweep: 33551, perFidTokenSweep: 3355055, hourlyPerFidTokenCallsPer30Days: 2415639600, dailyWalletCallsPer30Days: 3000 });
  assert.throws(() => estimateCalls(1, 1, 0));
});
test('only explicit countries in shared location descriptions are assigned', () => {
  assert.equal(countryFromDescription('Los Angeles, CA, USA'), 'US');
  assert.equal(countryFromDescription('Sydney NSW, Australia'), 'AU');
  assert.equal(countryFromDescription('London'), null);
  assert.equal(countryFromDescription('Paris, Texas'), null);
  assert.equal(countryFromDescription('Earth'), null);
  assert.equal(country({ profile: { location: { address: { country_code: 'ZZ' } } } }), null);
});
test('official profiles validate identity and retain unavailable/absent status', () => {
  assert.equal(officialProfile({ result: { user: { fid: 2, profile: {} } } }, 3), null);
  const p = officialProfile({ result: { user: { fid: 2, profile: {}, viewerContext: { optInStatus: 'moderated_out' } } } }, 2);
  assert.equal(p.voteStatus, 'moderated_out');
  assert.equal(p.tokenStatus, 'not_returned');
  assert.equal(p.country, null);
  assert.equal(officialProfile({ result: { user: { fid: 2, profile: {} } } }, 2).voteStatus, 'unavailable');
  assert.equal(officialProfile({ result: { user: { fid: 2, profile: { profileToken: { tokenUri: '' } } } } }, 2).tokenStatus, 'none');
});

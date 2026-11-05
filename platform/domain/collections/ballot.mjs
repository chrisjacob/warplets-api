import { DAY_MS, checkId, checkTimestamp, requirePolicy, walletSnapshot } from './policy.mjs';

export const BALLOT_CHOICES = Object.freeze(['ASAP', '7', '14', '30']);
export const NOTICE_MS = 2 * DAY_MS;

/** Snapshot input from the canonical owner and whitelist services at opensAt.
 * Persistent vote writes must serialize on (ballotId, wallet) at the storage boundary.
 */
export function openBallot({ id, opensAt, currentTrancheOpenedAt, holders, nextWhitelist }) {
  checkId(id);
  checkTimestamp(opensAt);
  checkTimestamp(currentTrancheOpenedAt);
  requirePolicy(opensAt >= currentTrancheOpenedAt, 'ballot_before_current_tranche');
  const voters = walletSnapshot([...walletSnapshot(holders), ...walletSnapshot(nextWhitelist)]);
  return Object.freeze({ id, opensAt, closesAt: checkTimestamp(opensAt + NOTICE_MS),
    currentTrancheOpenedAt, voters, votes: Object.freeze([]) });
}

export function castVote(ballot, { wallet, choice, at }) {
  checkTimestamp(at);
  requirePolicy(at >= ballot.opensAt && at < ballot.closesAt, 'ballot_closed');
  requirePolicy(ballot.voters.includes(checkId(wallet)), 'voter_ineligible');
  requirePolicy(BALLOT_CHOICES.includes(choice), 'invalid_choice');
  requirePolicy(!ballot.votes.some(vote => vote.wallet === wallet), 'wallet_already_voted');
  const votes = Object.freeze([...ballot.votes, Object.freeze({ wallet, choice })]);
  return Object.freeze({ ...ballot, votes });
}

export function tallyBallot(ballot, at) {
  requirePolicy(checkTimestamp(at) >= ballot.closesAt, 'ballot_still_open');
  const counts = Object.fromEntries(BALLOT_CHOICES.map(choice => [choice, 0]));
  for (const { choice } of ballot.votes) counts[choice]++;
  return Object.freeze({ eligibleWallets: ballot.voters.length, votesCast: ballot.votes.length,
    counts: Object.freeze(counts) });
}

/** Pure constraint on the founder-selected date, independent of vote counts. A later
 * actual opening also requires the published price, limit, stage capacity and notice.
 */
export function earliestTrancheOpening({ ballot, founderChoice, decidedAt, noticeAt }) {
  requirePolicy(BALLOT_CHOICES.includes(founderChoice), 'invalid_choice');
  requirePolicy(checkTimestamp(decidedAt) >= ballot.closesAt, 'ballot_still_open');
  checkTimestamp(noticeAt);
  const interval = founderChoice === 'ASAP' ? 0 : Number(founderChoice) * DAY_MS;
  return checkTimestamp(Math.max(decidedAt, noticeAt + NOTICE_MS, ballot.currentTrancheOpenedAt + interval));
}

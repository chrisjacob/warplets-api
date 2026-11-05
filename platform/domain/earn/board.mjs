import { compareIds, epochAt, id, integer, MIN_STAKE_MICRO_USD, units } from './values.mjs';
import { multiplierTenths } from './multiplier.mjs';

// A stake read must belong to this position, and be verified for its individual
// checkpoint. The evidence collector resolves price freshness, liquidity and slots.
function eligibleStake(evidence, submission, expectedMs) {
  if (evidence?.status !== 'verified') return null;
  if (evidence.userId !== submission.userId || evidence.tokenId !== submission.tokenId
      || evidence.asOfMs !== expectedMs) {
    throw new TypeError('stake evidence belongs to another position or checkpoint');
  }
  return units(evidence.microUsd, 'stake.microUsd') >= MIN_STAKE_MICRO_USD;
}

function compareRanks(a, b) {
  return b.pointsTenths - a.pointsTenths || b.contentScore - a.contentScore
    || a.submittedAtMs - b.submittedAtMs || compareIds(a.submissionId, b.submissionId);
}

// This is a pure settlement gate, not a moderation endpoint. complete must come
// from trusted source reconciliation (including the empty bootstrap case).
export function rankBoard({ epoch, complete, submissions, participants, campaigns }) {
  integer(epoch, 'epoch');
  if (complete !== true) return { epoch, status: 'pending', reason: 'incomplete-source' };
  const cutoffMs = integer((epoch + 1) * 86_400_000 - 1, 'cutoffMs');
  const positions = new Map();
  for (const campaign of campaigns) {
    id(campaign.tokenId, 'campaign.tokenId');
    integer(campaign.activationMs, 'campaign.activationMs');
    if (positions.has(campaign.tokenId)) throw new TypeError('duplicate campaign');
    positions.set(campaign.tokenId, campaign);
  }
  const users = new Map();
  for (const participant of participants) {
    id(participant.userId, 'userId');
    id(participant.wallet, 'wallet');
    if (users.has(participant.userId)) throw new TypeError('duplicate participant snapshot');
    users.set(participant.userId, participant);
  }
  const ids = new Set();
  const seenTokens = new Map();
  const winners = new Map();
  for (const submission of submissions) {
    const { submissionId, userId, tokenId, submittedAtMs, contentScore } = submission;
    id(submissionId, 'submissionId');
    id(userId, 'userId');
    id(tokenId, 'tokenId');
    if (epochAt(submittedAtMs) !== epoch) throw new RangeError('submission belongs to another board');
    if (ids.has(submissionId)) throw new TypeError('duplicate submission id');
    ids.add(submissionId);
    const tokens = seenTokens.get(userId) ?? new Set();
    if (tokens.has(tokenId)) throw new TypeError('only one submission per user, token and board');
    tokens.add(tokenId);
    if (tokens.size > 10) throw new RangeError('too many campaign submissions');
    seenTokens.set(userId, tokens);
    const campaign = positions.get(tokenId);
    if (!campaign || submittedAtMs < campaign.activationMs
        || submittedAtMs >= campaign.activationMs + 10 * 86_400_000) {
      throw new RangeError('submission outside active campaign');
    }
    if (contentScore == null) return { epoch, status: 'pending', reason: 'moderation' };
    integer(contentScore, 'contentScore', 0, 10);
    if (contentScore === 0) continue;
    const atEntry = eligibleStake(submission.atSubmission, submission, submittedAtMs);
    const atClose = eligibleStake(submission.atSnapshot, submission, cutoffMs);
    if (atEntry === false || atClose === false) continue;
    if (atEntry === null || atClose === null) return { epoch, status: 'pending', reason: 'stake-evidence' };
    const participant = users.get(userId);
    if (!participant?.components) return { epoch, status: 'pending', reason: 'participant-evidence' };
    const multiplier = multiplierTenths(participant.components);
    const candidate = { userId, wallet: participant.wallet, submissionId, tokenId, submittedAtMs,
      contentScore, multiplierTenths: multiplier, pointsTenths: contentScore * multiplier };
    if (!winners.has(userId) || compareRanks(candidate, winners.get(userId)) < 0) {
      winners.set(userId, candidate);
    }
  }
  const ranked = [...winners.values()].sort(compareRanks);
  const wallets = new Set();
  for (const { wallet } of ranked) {
    if (wallets.has(wallet)) return { epoch, status: 'pending', reason: 'wallet-conflict' };
    wallets.add(wallet);
  }
  return { epoch, status: 'final', winners: ranked.slice(0, 100) };
}

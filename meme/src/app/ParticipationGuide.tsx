import type { Identity } from "./client";
import type { LocalState } from "./LocalRounds";
/** Read-only guidance from the same authoritative round/session as voting. */
export function ParticipationGuide({
  data,
  identity,
  live,
  now,
  stale,
  onConnect,
  onRewards,
}: {
  data: LocalState;
  identity: Identity | null;
  live: boolean;
  now: number;
  stale: boolean;
  onConnect: () => void;
  onRewards?: () => void;
}) {
  const connected = !!identity?.farcasterFid,
    verified = connected && !!identity?.solanaWallet,
    voted = verified && !!data.myVote,
    round = data.round,
    choice = round?.candidates.find(
      (c) => c.id === data.myVote?.candidate_id,
    )?.name,
    selected =
      round?.candidates.find((c) => c.id === round.selected_candidate)?.name ??
      round?.selected_name;
  const resolved = round?.state === "selected" || round?.state === "skipped",
    closed =
      round?.state === "closed" || (round != null && now >= round.closes_at);
  const title = stale
    ? "Checking the round"
    : data.participationPaused
      ? "Voting is paused"
      : round?.state === "skipped"
        ? "No launch today"
        : round?.state === "selected"
          ? "Selected: " + (selected ?? round.selected_candidate ?? "OG")
          : closed
            ? "Selection pending"
            : !connected
              ? "Start with Farcaster"
              : !verified
                ? "Set your reward wallet"
                : voted
                  ? "Your vote is in"
                  : live
                    ? "You’re ready to vote"
                    : "Ready for the next step";
  const copy = stale
    ? "Retry above to confirm the latest state."
    : data.participationPaused
      ? "Voting is paused. Check back for an update."
      : round?.state === "skipped"
        ? "10X skipped this launch. You can still explore past rounds."
        : round?.state === "selected"
          ? "Selection does not mean a token has launched. Follow the next update here."
          : closed
            ? "Voting has closed. 10X will select an OG or skip this launch."
            : !connected
              ? "Your Farcaster account identifies your vote."
              : !verified
                ? "Verify a Solana wallet to receive rewards. Sign a message; no funds move."
                : voted
                  ? (choice
                      ? "You chose " + choice + ". "
                      : "Your choice is recorded. ") +
                    (live
                      ? "Change it below until voting closes."
                      : "Follow the operator’s selection.")
                  : live
                    ? "Choose one OG below. You can change your vote until close."
                    : "Check the round status below. Verified wallets stay ready.";
  return (
    <section className="participation-guide" aria-label="Your next step">
      <ol className="participation-steps" aria-label="Participation progress">
        {[
          ["Connect", connected],
          ["Verify wallet", verified],
          ["Vote", voted],
        ].map(([name, done], i) => (
          <li key={String(name)} className={done ? "is-complete" : ""}>
            <span aria-hidden="true">{done ? "✓" : i + 1}</span>
            {name}
          </li>
        ))}
      </ol>
      <h3>{title}</h3>
      <p>{copy}</p>
      {resolved && round.outcome_reason && <p>{round.outcome_reason}</p>}
      {!stale &&
        !data.participationPaused &&
        !resolved &&
        !closed &&
        !verified && (
          <button className="primary" onClick={onConnect}>
            {connected
              ? "Verify wallet"
              : round
                ? "Connect to vote"
                : "Set up account"}
          </button>
        )}
      {verified && voted && onRewards && (
        <button className="secondary" onClick={onRewards}>
          View rewards →
        </button>
      )}
    </section>
  );
}

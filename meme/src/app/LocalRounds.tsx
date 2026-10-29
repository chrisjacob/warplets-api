import { useEffect, useState } from "react";
import { api, type Identity } from "./IdentityPanel";
export interface RoundView {
  id: string;
  state: string;
  attribute: string | null;
  ownershipMode?: string;
  opens_at: number;
  closes_at: number;
  selected_candidate: string | null;
  outcome_reason: string | null;
  candidates: {
    id: string;
    name: string;
    symbol: string;
    uniqueVoters: number;
    weightedVotes?: string;
  }[];
}
export interface LocalState {
  round: RoundView | null;
  holdingComplete?: boolean;
  myVote?: {
    candidate_id: string;
    first_valid_at: number;
    reward_wallet: string;
  } | null;
  history: RoundView[];
  boost?: {
    total: string;
    warplet: string;
    holding: string;
    streak: string;
    points: string;
    finality: string;
    holdingStatus?: string;
  };
  leaderboard?: { fid: number; points: string; rank: number }[];
  entitlements?: {
    edition_id: string;
    amount: string;
    release_at: number;
    state: string;
  }[];
}
export function useLocalState(identity: Identity | null) {
  const [data, setData] = useState<LocalState | null>(null),
    [error, setError] = useState<string | null>(null);
  const refresh = async () => {
    try {
      setData((await api("/api/meme/state")) as LocalState);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Local API unavailable");
    }
  };
  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 15000);
    return () => clearInterval(id);
  }, [identity?.farcasterFid, identity?.solanaWallet]);
  return { data, error, refresh };
}
export function LocalRounds({
  data,
  identity,
  refresh,
}: {
  data: LocalState | null;
  identity: Identity | null;
  refresh: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const r = data?.round;
  async function cast(candidateId: string) {
    if (!r) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/meme/rounds/${r.id}/vote`, {
        candidateId,
        key: crypto.randomUUID(),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Vote failed");
    } finally {
      setBusy(false);
    }
  }
  if (!r)
    return (
      <article className="card">
        <h2>No round available.</h2>
        <p>Come back for the next daily vote.</p>
      </article>
    );
  const eligible = !!identity?.farcasterFid && !!identity.solanaWallet;
  return (
    <section aria-label="Today's round">
      <p className="eyebrow">
        {r.id} · {r.state} ·{" "}
        {r.ownershipMode === "simulated"
          ? "simulated ownership"
          : "observed ownership"}
      </p>
      <h2>
        {r.attribute
          ? `Today's attribute: ${r.attribute}`
          : "Attribute not revealed"}
      </h2>
      <p>
        Voting closes {new Date(r.closes_at).toUTCString()}. Community voting is
        advisory.
      </p>
      {data?.boost ? (
        <article className="card">
          <h3>
            Your {data.boost.finality} boost: {data.boost.total}×
          </h3>
          <p>
            Warplet +{data.boost.warplet} · Holding +{data.boost.holding} ·
            Streak +{data.boost.streak}
          </p>
          <p>{data.boost.points} reward points</p>
        </article>
      ) : (
        <p>Your score becomes available after the ownership reveal.</p>
      )}
      {!eligible && (
        <p>
          Connect Farcaster and verify a Solana reward wallet to vote. Base
          wallets are optional for Warplet boosts.
        </p>
      )}
      {data?.holdingComplete === false && (
        <p role="status">
          Holding evidence is incomplete. Scores are provisional and settlement
          is blocked.
        </p>
      )}
      <div className="candidates">
        {r.candidates.map((c) => (
          <article className="card candidate" key={c.id}>
            <h3>
              {c.name} · ${c.symbol}
            </h3>
            <p>
              {c.uniqueVoters} unique voters ·{" "}
              {c.weightedVotes ?? String(c.uniqueVoters)} weighted votes
            </p>
            <button
              disabled={!eligible || busy || r.state !== "open"}
              onClick={() => void cast(c.id)}
            >
              {data?.myVote?.candidate_id === c.id
                ? "Voted for " + c.symbol
                : "Vote for " + c.symbol}
            </button>
          </article>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      {data?.myVote && (
        <p className="fine">
          First valid vote: {new Date(data.myVote.first_valid_at).toUTCString()}
          . Changing candidates keeps this tie-break time and your frozen reward
          destination.
        </p>
      )}
      <article className="card">
        <h3>Operator selection</h3>
        <p>
          {r.state === "skipped"
            ? `Skipped: ${r.outcome_reason}`
            : r.selected_candidate
              ? `Selected: ${r.selected_candidate}. Launch execution is a later milestone.`
              : "Awaiting operator selection after voting closes."}
        </p>
      </article>
      {data?.leaderboard && (
        <article className="card">
          <h3>Leaderboard</h3>
          {data.leaderboard.map((row) => (
            <p key={row.fid}>
              #{row.rank} · FID {row.fid} · {row.points} points
            </p>
          ))}
        </article>
      )}
    </section>
  );
}
export function OperatorPanel() {
  const [token, setToken] = useState(""),
    [route, setRoute] = useState("/api/meme/operator/rounds"),
    [body, setBody] = useState("{}"),
    [result, setResult] = useState("");
  async function submit() {
    try {
      const parsed = JSON.parse(body);
      if (!route.startsWith("/api/meme/operator/"))
        throw Error("Operator route required");
      const response = await fetch(route, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + token,
        },
        body: JSON.stringify(parsed),
      });
      setResult(JSON.stringify(await response.json(), null, 2));
    } catch (e) {
      setResult(e instanceof Error ? e.message : "Request failed");
    }
  }
  return (
    <section className="card">
      <h2>Local operator</h2>
      <p>Authenticated local controls. The token stays in memory.</p>
      <label>
        Operator token
        <input
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </label>
      <label>
        API route
        <input value={route} onChange={(e) => setRoute(e.target.value)} />
      </label>
      <label>
        Request JSON
        <textarea
          rows={12}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <button onClick={() => void submit()}>Submit operator action</button>
      <pre>{result}</pre>
    </section>
  );
}

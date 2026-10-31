import { useReadPage } from "./useReadPage";
import { lazy, Suspense } from "react";
import { qaEnabled } from "./qaMode";
const Claims = import.meta.env.DEV
  ? lazy(() =>
      import("./QAInteractions").then((m) => ({ default: m.QAClaims })),
    )
  : null;
import {
  rewardTotals,
  tokenAmount,
  rewardStatus,
  type Entitlement,
} from "./rewards";
export default function RewardsPanel({ fid }: { fid: number }) {
  const page = useReadPage<{
    id: string;
    launchedAt: number;
    rewards: Entitlement[];
  }>("/api/meme/rewards", fid);
  const totals = rewardTotals(page.items.flatMap((c) => c.rewards));
  const released = totals.filter((e) => rewardStatus(e) === "Released"),
    upcoming = totals.filter((e) =>
      ["Releasing", "Scheduled"].includes(rewardStatus(e)),
    ),
    unfunded = totals.filter((e) => rewardStatus(e) === "Unfunded"),
    claimed = totals.filter((e) => rewardStatus(e) === "Claimed");
  const count = (rows: Entitlement[]) =>
    !page.items.length && (page.loading || page.error)
      ? "—"
      : new Set(rows.map((e) => e.edition_id)).size;
  function rewardRows(rows: Entitlement[]) {
    return rows.map((e) => (
      <article
        className="reward-row"
        key={JSON.stringify([
          e.edition_id,
          e.reward_wallet,
          e.mode,
          e.fundingState,
          e.releaseState,
          e.claimState,
        ])}
      >
        <div>
          <strong>
            {tokenAmount(e.amount, e.decimals)} {e.symbol}
          </strong>
          <p
            className={
              "reward-state " +
              (rewardStatus(e) === "Released" ? "is-released" : "")
            }
          >
            {rewardStatus(e)}
            {e.mode === "simulated" ? " · Simulated" : ""}
          </p>
          <details>
            <summary>Details</summary>
            <p>
              Destination: <code>{e.reward_wallet}</code>
            </p>
            <p>
              Scheduled through {new Date(e.release_at).toLocaleDateString()}
            </p>
          </details>
        </div>
      </article>
    ));
  }
  return (
    <section className="card" aria-label="Rewards" aria-busy={page.loading}>
      <div className="list-heading">
        <h2>Your rewards</h2>
        <button
          className="text-button"
          disabled={page.loading}
          onClick={() => void page.refresh()}
        >
          Refresh
        </button>
      </div>
      <p className="fine">
        Each token stays separate. Rewards accumulate across launches.
      </p>
      <div className="reward-summary" aria-label="Reward overview">
        <div>
          <strong>{count(released)}</strong>
          <span>Released assets</span>
        </div>
        <div>
          <strong>{count(upcoming)}</strong>
          <span>Upcoming assets</span>
        </div>
        <div>
          <strong>{count(claimed)}</strong>
          <span>Claimed assets</span>
        </div>
      </div>
      {page.hasMore && (
        <p className="fine">
          Totals below cover loaded campaigns. Load older rewards to see more.
        </p>
      )}
      {qaEnabled && Claims ? (
        <Suspense fallback={<p>Loading demo claims…</p>}>
          <Claims onChanged={() => page.refresh()} />
        </Suspense>
      ) : (
        <button disabled>Claims coming later</button>
      )}
      {!!released.length && (
        <section aria-label="Released rewards">
          <h3 className="reward-section-heading">Released</h3>
          {rewardRows(released)}
        </section>
      )}
      {!!upcoming.length && (
        <section aria-label="Upcoming rewards">
          <h3 className="reward-section-heading">Coming up</h3>
          {rewardRows(upcoming)}
        </section>
      )}
      {!!unfunded.length && (
        <section aria-label="Unfunded rewards">
          <h3 className="reward-section-heading">Awaiting funding</h3>
          <p className="rewards-note">
            Final scores are recorded. These allocations are not funded yet.
          </p>
          {rewardRows(unfunded)}
        </section>
      )}
      {!!claimed.length && (
        <details className="claimed-rewards">
          <summary>Claimed rewards · {claimed.length} balances</summary>
          {rewardRows(claimed)}
        </details>
      )}
      {page.loading && <p role="status">Loading rewards…</p>}
      {page.error && (
        <div role="alert">
          <p>{page.error}</p>
          <button onClick={() => void page.retry()}>Retry</button>
        </div>
      )}
      {!page.loading && !page.error && !totals.length && (
        <p>No rewards yet. Vote in the next round.</p>
      )}
      {page.hasMore && !page.error && (
        <button disabled={page.loading} onClick={() => void page.more()}>
          Load older rewards
        </button>
      )}
    </section>
  );
}

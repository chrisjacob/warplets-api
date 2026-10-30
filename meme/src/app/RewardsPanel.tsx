import { useReadPage } from "./useReadPage";
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
      {page.hasMore && (
        <p className="fine">
          Totals below cover loaded campaigns. Load older rewards to see more.
        </p>
      )}
      {totals.map((e) => (
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
            <p>
              {rewardStatus(e)}
              {e.mode === "simulated" ? " · Simulated" : ""}
            </p>
            <details>
              <summary>Details</summary>
              <p>Destination: {e.reward_wallet}</p>
              <p>
                Scheduled through {new Date(e.release_at).toLocaleDateString()}
              </p>
            </details>
          </div>
        </article>
      ))}
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
      <button disabled>Claims coming later</button>
    </section>
  );
}

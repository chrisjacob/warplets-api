import { useReadPage } from "./useReadPage";
import type { RoundView } from "./LocalRounds";
import { qaEnabled } from "./qaMode";
type HistoryEntry = Pick<
  RoundView,
  | "id"
  | "closes_at"
  | "state"
  | "selected_candidate"
  | "selected_name"
  | "outcome_reason"
>;
export default function HistoryPanel() {
  const page = useReadPage<
    HistoryEntry & { edition?: { id: string; symbol: string; mint: string } }
  >("/api/meme/history");
  return (
    <section
      className="card"
      aria-label="Round history"
      aria-busy={page.loading}
    >
      <div className="list-heading">
        <h2>Past rounds</h2>
        <button
          className="text-button"
          disabled={page.loading}
          onClick={() => void page.refresh()}
        >
          Refresh
        </button>
      </div>
      {page.items.map((r) => (
        <article className="history-row" key={r.id}>
          <div>
            <h3>
              <time dateTime={new Date(r.closes_at).toISOString()}>
                {new Date(r.closes_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year:
                    new Date(r.closes_at).getFullYear() !==
                    new Date().getFullYear()
                      ? "numeric"
                      : undefined,
                })}
              </time>
            </h3>
            <p>
              {r.state === "skipped"
                ? "Skipped"
                : r.selected_candidate
                  ? "Selected: " + (r.selected_name ?? r.selected_candidate)
                  : "Selection pending"}
            </p>
          </div>
          {r.outcome_reason && <p>{r.outcome_reason}</p>}
          {qaEnabled && r.edition && (
            <a
              href={
                "/?" +
                new URLSearchParams({
                  qa: "seeded",
                  qaPersona:
                    new URLSearchParams(location.search).get("qaPersona") ??
                    "participant",
                  view: "Today",
                  market: r.edition.id,
                })
              }
            >
              {r.edition.symbol} · View performance ↗
            </a>
          )}
        </article>
      ))}
      {page.loading && <p role="status">Loading rounds…</p>}
      {page.error && (
        <div role="alert">
          <p>{page.error}</p>
          <button onClick={() => void page.retry()}>Retry</button>
        </div>
      )}
      {!page.loading && !page.error && !page.items.length && (
        <p>No past rounds yet.</p>
      )}
      {page.hasMore && !page.error && (
        <button disabled={page.loading} onClick={() => void page.more()}>
          Load more rounds
        </button>
      )}
    </section>
  );
}

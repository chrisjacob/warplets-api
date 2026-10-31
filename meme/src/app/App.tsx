import { lazy, Suspense, useEffect, useState, useRef } from "react";
import Onboarding from "./Onboarding";
import { miniRuntime } from "./miniRuntime";
import { qaEnabled, qaContext } from "./qaMode";
import { preview } from "../shared/fixtures";
import { LocalRounds, OperatorPanel, useLocalState } from "./LocalRounds";
import { IdentityPanel } from "./IdentityPanel";
import { Tabs, type Tab as LaunchTab } from "./Tabs";
import { AppHeader } from "./AppHeader";
import { FeedbackProvider } from "./Feedback";
import NotificationDisclosure from "./NotificationDisclosure";
import SectionBoundary from "./SectionBoundary";
const HistoryPanel = lazy(() => import("./HistoryPanel"));
const RewardsPanel = lazy(() => import("./RewardsPanel"));
const MarketsPanel = lazy(() => import("./MarketsPanel"));
const LeadersPanel = lazy(() => import("./LeadersPanel"));
type Tab = "Today" | "Rewards" | "Launches";
function FixtureApp() {
  const [tab, setTab] = useState<Tab>("Today");
  const { round, boost } = preview;
  return (
    <div className="shell">
      <header>
        <a className="brand" href="#">
          10X<span>.meme</span>
        </a>
        <button disabled>Connect · fixture</button>
      </header>
      <main>
        <div className="intro">
          <p className="eyebrow">One launch. Every day. Or skip.</p>
          <h1>
            A daily ritual.
            <br />
            <em>A new possibility.</em>
          </h1>
          <p>
            Claim your rewards, discover today’s attribute, and help shape the
            next OG-paired launch.
          </p>
        </div>
        <aside className="fixture-note" role="note">
          Simulated data · voting, wallet connections, launches and claims are
          disabled.
        </aside>
        <nav aria-label="Launchpad">
          <div role="tablist">
            {(["Today", "Rewards", "Launches"] as Tab[]).map((name) => (
              <button
                key={name}
                role="tab"
                aria-selected={tab === name}
                onClick={() => setTab(name)}
              >
                {name}
              </button>
            ))}
          </div>
        </nav>
        {tab === "Today" && (
          <section aria-label="Today">
            <div className="top-grid">
              <article className="card reward-card">
                <p className="eyebrow">From previous launches</p>
                <h2>
                  45,120 <span>10XORBIT</span>
                </h2>
                <p>
                  Available in this preview. New launches begin releasing
                  rewards after 24 hours.
                </p>
                <button className="primary" disabled>
                  Claim all rewards
                </button>
              </article>
              <article className="card boost-card">
                <p className="eyebrow">Your provisional boost</p>
                <div className="boost">
                  {boost.total.toFixed(1)}
                  <small>×</small>
                </div>
                <p>
                  {boost.featuredAttribute} · level {boost.eligibleLevel}
                </p>
                <div className="boost-parts">
                  {[
                    ["Base", boost.base],
                    ["Warplet", boost.warplet],
                    ["Holding", boost.holding],
                    ["Streak", boost.streak],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <strong>{Number(value).toFixed(1)}×</strong>
                    </div>
                  ))}
                </div>
                <p className="fine">
                  Ownership freezes before the reveal. Boosts settle at voting
                  close.
                </p>
              </article>
            </div>
            <div className="section-title">
              <div>
                <p className="eyebrow">Today’s shortlist</p>
                <h2>Make your voice count.</h2>
              </div>
              <span className="pill">Advisory vote</span>
            </div>
            <p className="section-copy">
              One active vote per Farcaster identity. 10X makes the final
              selection and can skip a launch.
            </p>
            <div className="candidates">
              {round.candidates.map((candidate, index) => (
                <article className="card candidate" key={candidate.id}>
                  <div className={"token token-" + index} aria-hidden="true">
                    {candidate.symbol.slice(0, 1)}
                  </div>
                  <div className="candidate-name">
                    <h3>{candidate.name}</h3>
                    <span>${candidate.symbol}</span>
                  </div>
                  <dl>
                    <div>
                      <dt>Unique voters</dt>
                      <dd>{candidate.uniqueVoters}</dd>
                    </div>
                    <div>
                      <dt>Weighted votes</dt>
                      <dd>{candidate.weightedVotes.toFixed(1)}</dd>
                    </div>
                  </dl>
                  <button disabled>Vote for {candidate.symbol}</button>
                </article>
              ))}
            </div>
            <p className="fine">
              Leaderboard is provisional. Your preview vote would carry{" "}
              {boost.voteWeight.toFixed(1)} weight and earn {boost.rewardPoints}{" "}
              reward points. Voting for the selected token earns no extra
              reward.
            </p>
            <article className="card">
              <p className="eyebrow">Selection and launch</p>
              <h2>Voting open. Selection ahead.</h2>
              <p>
                After voting closes, the operator reviews the shortlist and
                selects one OG pairing or skips the launch.
              </p>
              <p className="fine">
                Fixture status: awaiting operator selection. A successful launch
                starts its own ten-day campaign; the first reward allocation
                follows actual launch +24 hours.
              </p>
            </article>
          </section>
        )}
        {tab === "Rewards" && (
          <section className="card" aria-label="Rewards">
            <p className="eyebrow">Your rewards</p>
            <h2>Rewards keep accumulating.</h2>
            <p>
              Each campaign has a claim deadline. Claiming does not change your
              points or voting streak.
            </p>
            <div className="reward-row">
              <div>
                <strong>10X Orbit</strong>
                <p>45,120 10XORBIT · available in fixture</p>
              </div>
              <button disabled>Claim</button>
            </div>
            <p className="fine">
              Claim all may need multiple transactions. Users pay network and
              required token-account costs.
            </p>
          </section>
        )}
        {tab === "Launches" && (
          <section className="card" aria-label="Launches">
            <p className="eyebrow">Launch history</p>
            <h2>Follow each ten-day campaign.</h2>
            <div className="reward-row">
              <div>
                <strong>10X Orbit / ORBIT</strong>
                <p>90% liquidity · 10% community rewards</p>
              </div>
              <span className="pill">Fixture edition</span>
            </div>
            <p>
              One percent of total supply releases each day, starting at launch
              +24 hours and ending at +240 hours.
            </p>
            <p className="fine">
              Existing campaigns continue when a new daily launch is skipped.
            </p>
          </section>
        )}
      </main>
      <footer>
        <span>10X.meme</span>
        <span>Solana launches · Base Warplets · Farcaster participation</span>
      </footer>
    </div>
  );
}

function LaunchpadApp() {
  const helpOpener = useRef<HTMLElement | null>(null);
  const [help, setHelp] = useState(false),
    [helpRequest, setHelpRequest] = useState(0);
  function showHelp(opener: HTMLElement | null) {
    helpOpener.current = opener;
    setHelp(true);
    setHelpRequest((n) => n + 1);
  }
  useEffect(() => {
    void miniRuntime();
  }, []);
  const [fixture, setFixture] = useState(
      import.meta.env.DEV &&
        new URLSearchParams(location.search).has("fixture"),
    ),
    [tab, setTab] = useState<LaunchTab>(
      () =>
        (["Rewards", "Leaders", "History"] as LaunchTab[]).find(
          (v) => v === new URLSearchParams(location.search).get("view"),
        ) ?? "Today",
    ),
    [connectOpen, setConnectOpen] = useState(false);
  const { data, identity, error, refresh, onIdentity } =
    useLocalState(!fixture);
  function changeTab(next: LaunchTab) {
    if (next === tab) return;
    setTab(next);
    const url = new URL(location.href);
    if (next === "Today") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    history.replaceState(null, "", url);
    window.scrollTo({ top: 0, behavior: "auto" });
  }
  function openAccount() {
    if (qaEnabled) {
      const controls = document.querySelector<HTMLDetailsElement>(
        ".qa-toolbar details",
      );
      if (controls) {
        controls.open = true;
        controls.scrollIntoView({ block: "start" });
      }
    } else setConnectOpen(true);
  }
  if (import.meta.env.DEV && fixture)
    return (
      <>
        <button className="mode-toggle" onClick={() => setFixture(false)}>
          Back to app
        </button>
        <FixtureApp />
      </>
    );
  return (
    <div className="shell local-app">
      <a className="skip-link" href="#launchpad-panel">
        Skip to content
      </a>
      <AppHeader
        onHelp={showHelp}
        onAccount={openAccount}
        account={
          qaEnabled ? (
            <button onClick={openAccount}>
              {qaContext?.person?.name ?? "Choose demo account"} · Demo
            </button>
          ) : (
            <IdentityPanel
              identity={identity}
              onIdentity={onIdentity}
              open={connectOpen}
              onOpenChange={setConnectOpen}
            />
          )
        }
      />
      <main>
        <div className="page-heading">
          <div>
            <p className="eyebrow">The daily launchpad</p>
            <h1>One launch. Or skip.</h1>
          </div>
          <span className="preview-label">
            {qaEnabled ? "QA simulation" : "Local preview"}
          </span>
        </div>
        <p className="fine preview-notice">
          {qaEnabled
            ? "All activity is simulated. No funds move."
            : "No funds move. Launches and claims are disabled."}
        </p>
        <Tabs value={tab} onChange={changeTab} />
        {(tab === "Today" || help) && (
          <Onboarding
            key={help ? "help:" + helpRequest : "first"}
            replay={help}
            opener={helpOpener.current}
            onDone={() => setHelp(false)}
          />
        )}
        {error && (
          <div className="error-notice" role="alert">
            <span>{error}</span>
            <button onClick={() => void refresh()}>Retry</button>
          </div>
        )}
        <div
          id="launchpad-panel"
          role="tabpanel"
          tabIndex={-1}
          aria-labelledby={"tab-" + tab}
        >
          {tab === "Today" && (
            <>
              <LocalRounds
                data={data}
                identity={identity}
                refresh={refresh}
                onConnect={() => {
                  if (qaEnabled) {
                    const url = new URL(location.href);
                    url.searchParams.set("qaPersona", "participant");
                    location.href = url.href;
                  } else setConnectOpen(true);
                }}
                stale={!!error}
                onRewards={() => changeTab("Rewards")}
              />
              <SectionBoundary label="Markets">
                <Suspense fallback={<p role="status">Loading markets…</p>}>
                  <MarketsPanel />
                </Suspense>
              </SectionBoundary>
            </>
          )}
          {tab === "Leaders" && (
            <SectionBoundary label="Leaders">
              <Suspense fallback={<p role="status">Loading leaders…</p>}>
                <LeadersPanel data={data} onToday={() => changeTab("Today")} />
              </Suspense>
            </SectionBoundary>
          )}
          {tab === "Rewards" &&
            (identity?.farcasterFid ? (
              <>
                <SectionBoundary
                  label="Rewards"
                  key={"reward-panel:" + identity.farcasterFid}
                >
                  <Suspense fallback={<p role="status">Loading rewards…</p>}>
                    <RewardsPanel
                      key={"rewards:" + identity.farcasterFid}
                      fid={identity.farcasterFid}
                      onToday={() => changeTab("Today")}
                    />
                  </Suspense>
                </SectionBoundary>
                <NotificationDisclosure
                  key={"notifications:" + identity.farcasterFid}
                  fid={identity.farcasterFid}
                  onReconnect={openAccount}
                />
              </>
            ) : (
              <section className="card" aria-label="Rewards">
                <h2>Your rewards</h2>
                <p>Connect to see your rewards.</p>
                <button
                  className="primary"
                  onClick={() => {
                    if (qaEnabled) {
                      const url = new URL(location.href);
                      url.searchParams.set("qaPersona", "participant");
                      location.href = url.href;
                    } else setConnectOpen(true);
                  }}
                >
                  Connect
                </button>
              </section>
            ))}
          {tab === "History" && (
            <SectionBoundary label="History">
              <Suspense fallback={<p role="status">Loading rounds…</p>}>
                <HistoryPanel onToday={() => changeTab("Today")} />
              </Suspense>
            </SectionBoundary>
          )}
        </div>
        {!qaEnabled &&
          new URLSearchParams(location.search).get("operator") === "1" && (
            <OperatorPanel />
          )}
      </main>
      <footer>
        {import.meta.env.DEV && (
          <label
            className="qa-toggle"
            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            <input
              type="checkbox"
              checked={qaEnabled}
              onChange={(e) => {
                const url = new URL(location.href);
                for (const key of [
                  "fixture",
                  "market",
                  "trader",
                  "board",
                  "qaPersona",
                ])
                  url.searchParams.delete(key);
                if (e.target.checked) url.searchParams.set("qa", "seeded");
                else url.searchParams.delete("qa");
                location.href = url.href;
              }}
            />{" "}
            QA data
          </label>
        )}
        <span>Solana · Warplets · Farcaster</span>
        <button
          className="text-button"
          onClick={(event) => showHelp(event.currentTarget)}
        >
          How it works
        </button>
        <p className="footer-copyright">
          © 2026 Code Hunt Pty. Ltd. All rights reserved.
        </p>
        <nav className="footer-legal" aria-label="Legal">
          <a
            href="https://app.10x.meme/terms"
            target="_blank"
            rel="noopener noreferrer"
          >
            Terms of Service
          </a>
          <span aria-hidden="true">｜</span>
          <a
            href="https://app.10x.meme/privacy"
            target="_blank"
            rel="noopener noreferrer"
          >
            Privacy Policy
          </a>
        </nav>
        {import.meta.env.DEV && (
          <details className="local-tools">
            <summary>Local tools</summary>
            <button className="text-button" onClick={() => setFixture(true)}>
              Design preview
            </button>
          </details>
        )}
      </footer>
    </div>
  );
}
export function App() {
  return (
    <FeedbackProvider>
      <LaunchpadApp />
    </FeedbackProvider>
  );
}

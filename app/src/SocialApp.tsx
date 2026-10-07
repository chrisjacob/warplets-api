import MiniAppPageHero from "./MiniAppPageHero";
import {
  SocialModal,
  SocialDropdown,
  SocialReasonDialog,
  SocialAccount,
  SocialIcon,
} from "./SocialUI";
import SiteFooter from "./SiteFooter";
import { hapticPrimaryTap, hapticSelectionChanged } from "./haptics";
import SocialOnboarding from "./SocialOnboarding";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import sdk from "@farcaster/miniapp-sdk";
import { encodeFunctionData, parseAbi } from "viem";
import MiniAppShell from "./MiniAppShell";
import {
  MiniAppHeader,
  MiniAppMenuPage,
  useMiniAppChrome,
} from "./miniAppChrome";
import {
  loadAppSession,
  logoutAppPrincipal,
  verifyFarcasterQuickAuth,
  linkCurrentWalletAndIdentity,
  type AppSessionState,
} from "./appSession";
import { WebConnectModal } from "./WebConnectModal";
import FarcasterSignInControl from "./FarcasterSignInControl";
import { detectMiniAppContext } from "./miniAppContext";
import { configureAppSurface, openAppUrl } from "./surfaceAdapter";
import {
  configureFarcasterWallet,
  getConnectedProviderAndAccount,
  restoreWebWallet,
} from "./walletController";
import EmailWaitlistCta from "./EmailWaitlistCta";
import {
  calculateBoost,
  type BoostEvidence,
  type SocialConfig,
  type SocialPost,
} from "../shared/social";
import { socialRequest } from "./socialClient";
import SocialMedia from "./SocialMedia";
import { socialMediaUrls } from "../shared/socialEmbeds";
import "./SocialApp.css";
const SocialAdmin = lazy(() => import("./SocialAdmin"));
type Page = "feed" | "leaderboard" | "rewards" | "about" | "admin";
interface Me {
  member: {
    id: string;
    group_id: string;
    username: string;
    avatar: string | null;
    next_post_at: number;
  };
  evidence: BoostEvidence & {
    balances?: Array<{ name: string; qualifies: boolean }>;
    warnings?: string[];
  };
  evidenceUpdatedAt: number | null;
  boost: ReturnType<typeof calculateBoost>;
  totals: { points: number; today: number; explored: number };
  history: Array<{
    action: string;
    points: number;
    multiplier: number;
    day: string;
    created_at: number;
  }>;
  operations: Array<{
    id: string;
    payload_json: string;
    state: string;
    error: string;
    cast_hash: string | null;
  }>;
}
interface Config {
  config: SocialConfig;
  version: number;
  checkinAddress: string | null;
  signerConfigured: boolean;
  contextBonusAvailable: boolean;
}
interface Feed {
  posts: SocialPost[];
  next: number | null;
}
interface Comment {
  id: string;
  text: string;
  username: string;
  delivery: string;
}
const points = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 2 });
function Avatar({ name, url }: { name: string; url: string | null }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return url && !failed ? (
    <img
      className="social-avatar"
      alt=""
      src={url}
      onError={() => setFailed(true)}
    />
  ) : (
    <span
      className="social-avatar social-avatar-generated"
      style={{
        background: `hsl(${[...name].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 360, 0)} 45% 24%)`,
      }}
    >
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}
function postUrl(id: string) {
  return `${window.location.origin}${window.location.pathname.startsWith("/social") ? "/social" : ""}/post/${id}`;
}
function TextLinks({
  text,
  embedded = [],
}: {
  text: string;
  embedded?: string[];
}) {
  return (
    <>
      {text.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
        embedded.includes(
          part.replace(/[.,!;:)]+$/, ""),
        ) ? null : /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noreferrer">
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}
function PostCard({
  post,
  me,
  onAction,
  onOpen,
  run,
}: {
  post: SocialPost;
  me: Me | null;
  onAction: (p: SocialPost, kind: string) => Promise<void>;
  onOpen: (id: string) => void;
  run: (fn: () => Promise<unknown>) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const optionsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!optionsRef.current?.contains(e.target as Node) && optionsRef.current)
        optionsRef.current.open = false;
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && optionsRef.current?.open) {
        optionsRef.current.open = false;
        optionsRef.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  const [reporting, setReporting] = useState(false),
    [pendingAction, setPendingAction] = useState<string | null>(null),
    [feedback, setFeedback] = useState("");
  const perform = (kind: string, fn: () => Promise<unknown>) => {
    if (pendingAction) return;
    setPendingAction(kind);
    setFeedback("");
    void hapticPrimaryTap();
    run(async () => {
      try {
        const result = await fn();
        if (result !== false && me && kind !== "quote")
          setFeedback(
            kind === "share" ? "Link shared or copied." : "Action saved.",
          );
      } catch (e) {
        setFeedback(
          e instanceof Error ? e.message : "Please retry this action.",
        );
        throw e;
      } finally {
        setPendingAction(null);
      }
    });
  };
  useEffect(() => {
    if (!me || !ref.current) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let viewing = false;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible =
          entries[0]?.isIntersecting && document.visibilityState === "visible";
        if (!visible) {
          if (timer) clearTimeout(timer);
          viewing = false;
          return;
        }
        if (viewing) return;
        viewing = true;
        void socialRequest<{ id: string | null }>("view/start", {
          postId: post.id,
        })
          .then(({ id }) => {
            if (!id || cancelled || !viewing) return;
            timer = setTimeout(() => {
              if (document.visibilityState === "visible" && viewing)
                void socialRequest("view/complete", { id }).catch(
                  () => undefined,
                );
            }, 5200);
          })
          .catch(() => undefined);
      },
      { threshold: 0.65 },
    );
    observer.observe(ref.current);
    const hide = () => {
      if (document.hidden) {
        viewing = false;
        if (timer) clearTimeout(timer);
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      cancelled = true;
      observer.disconnect();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [me?.member.id, post.id]);
  return (
    <article className="social-post" ref={ref}>
      <div className="social-post-head">
        <Avatar name={post.username} url={post.avatar} />
        <div>
          <strong>{post.username}</strong>
          <small>
            {post.cast_hash ? "Farcaster" : "10X Social"} ·{" "}
            {new Date(post.submitted_at ?? post.created_at).toLocaleString(
              undefined,
              {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              },
            )}
          </small>
        </div>
        <span className="social-post-score">
          {points(post.points)}
          <small>points</small>
        </span>
      </div>
      {post.kind === "quote" && <span className="social-eyebrow">QUOTE</span>}
      <div className="social-post-text">
        <TextLinks
          text={post.text}
          embedded={socialMediaUrls(post.text, post.embeds)}
        />
      </div>
      <SocialMedia
        urls={socialMediaUrls(post.text, post.embeds)}
        postId={post.id}
      />
      <div className="social-post-actions">
        <button
          aria-label="Like post"
          disabled={!!pendingAction}
          aria-busy={pendingAction === "like"}
          onClick={() => perform("like", () => onAction(post, "like"))}
        >
          <SocialIcon name="like" />
          <span>{post.likes}</span>
        </button>
        <button aria-label="Read comments" onClick={() => onOpen(post.id)}>
          <SocialIcon name="comment" />
          <span>{post.comments}</span>
        </button>
        <button
          aria-label="Quote post"
          disabled={!!pendingAction}
          onClick={() => perform("quote", () => onAction(post, "quote"))}
        >
          <SocialIcon name="quote" />
        </button>
        {post.cast_hash && me?.evidence.signer && (
          <button
            aria-label="Recast post"
            disabled={!!pendingAction}
            aria-busy={pendingAction === "recast"}
            onClick={() => perform("recast", () => onAction(post, "recast"))}
          >
            <SocialIcon name="recast" />
            <span>{post.recasts}</span>
          </button>
        )}
        <button
          aria-label="Share post"
          disabled={!!pendingAction}
          onClick={() =>
            perform("share", async () => {
              const url = postUrl(post.id);
              if (navigator.share) {
                try {
                  await navigator.share({ title: "10X Social", url });
                } catch (e) {
                  if (e instanceof Error && e.name === "AbortError")
                    return false;
                  throw e;
                }
              } else {
                await navigator.clipboard.writeText(url);
              }
            })
          }
        >
          <SocialIcon name="share" />
        </button>
        <details ref={optionsRef} className="social-post-more">
          <summary aria-label="Post options">
            <SocialIcon name="more" />
          </summary>
          <div>
            <button onClick={() => onOpen(post.id)}>Open post</button>
            {me && (
              <>
                <button onClick={() => setReporting(true)}>Report</button>
                <button
                  onClick={() =>
                    run(async () => {
                      await socialRequest("mute", { postId: post.id });
                      window.dispatchEvent(new Event("social-refresh"));
                    })
                  }
                >
                  Mute author
                </button>
                {me.member.id === post.member_id && (
                  <button
                    onClick={() =>
                      run(async () => {
                        await socialRequest("delete", { postId: post.id });
                        window.dispatchEvent(new Event("social-refresh"));
                      })
                    }
                  >
                    Remove from 10X
                  </button>
                )}
              </>
            )}
          </div>
        </details>
      </div>
      {(pendingAction || feedback) && (
        <p className="social-action-feedback" role="status">
          {pendingAction ? "Saving?" : feedback}
        </p>
      )}
      {reporting && (
        <SocialReasonDialog
          title="Report post"
          onClose={() => setReporting(false)}
          onSubmit={async (reason) => {
            await socialRequest("report", { postId: post.id, reason });
            setFeedback("Report received.");
          }}
        />
      )}
    </article>
  );
}
function routePage(): Page {
  const value = new URLSearchParams(location.search).get("page");
  return value === "rewards" ||
    value === "leaderboard" ||
    value === "about" ||
    value === "admin"
    ? value
    : "feed";
}
export default function SocialApp() {
  const chrome = useMiniAppChrome("social");
  const [page, updatePage] = useState<Page>(routePage);
  const [composerOpen, setComposerOpen] = useState(false),
    [accountAnchor, setAccountAnchor] = useState<"title" | "avatar" | null>(
      null,
    );
  const composeAfterLogin = useRef(false),
    routeSequence = useRef(0);
  function saveScroll() {
    history.replaceState(
      { ...history.state, socialScroll: window.scrollY },
      "",
    );
  }
  function setPage(next: Page) {
    saveScroll();
    const url = new URL(location.href);
    url.pathname = url.pathname.startsWith("/social") ? "/social" : "/";
    url.searchParams.set("page", next);
    history.pushState({ socialNavigation: true, socialScroll: 0 }, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
    void hapticSelectionChanged();
  }
  function backToFeed() {
    if (history.state?.socialNavigation) history.back();
    else setPage("feed");
  }
  function startCompose() {
    void hapticPrimaryTap();
    setMessage("");
    setError(false);
    if (me) {
      setComposerOpen(true);
      return;
    }
    if (session?.authenticated) {
      run(async () => {
        await refreshMe();
        setComposerOpen(true);
      });
      return;
    }
    composeAfterLogin.current = true;
    setConnect(true);
  }
  const [config, setConfig] = useState<Config | null>(null),
    [session, setSession] = useState<AppSessionState | null>(null),
    [me, setMe] = useState<Me | null>(null),
    [mini, setMini] = useState(false),
    [connect, setConnect] = useState(false);
  const [feed, setFeed] = useState<Feed>({ posts: [], next: null }),
    [loading, setLoading] = useState(true),
    [sort, setSort] = useState("trending"),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState("");
  const [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(false),
    [casts, setCasts] = useState<Array<{
      hash: string;
      text: string;
      timestamp: string;
    }> | null>(null);
  const [detail, setDetail] = useState<{
      post: SocialPost;
      comments: Comment[];
    } | null>(null),
    [comment, setComment] = useState(""),
    [quote, setQuote] = useState<SocialPost | null>(null),
    [quoteText, setQuoteText] = useState("");
  const [leaders, setLeaders] = useState<
      Array<{
        id: string;
        username: string;
        avatar: string | null;
        points: number;
      }>
    >([]),
    [range, setRange] = useState("week");
  const [leadersLoading, setLeadersLoading] = useState(false);
  const [onboard, setOnboard] = useState(() => {
      try {
        return !localStorage.getItem("social-onboarding-v1");
      } catch {
        return true;
      }
    }),
    [now, setNow] = useState(Date.now());
  const pending = useRef<{
    operationId: string;
    source: string;
    text?: string;
    castHash?: string;
    quoteId?: string;
  } | null>(null);
  const refreshMe = useCallback(async () => {
    const s = await loadAppSession();
    setSession(s);
    if (s.authenticated) {
      const data = await socialRequest<Me>("me");
      setMe(data);
    } else setMe(null);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);
  const feedRequest = useRef(0);
  const loadFeed = useCallback(async () => {
    const request = ++feedRequest.current;
    setLoading(true);
    try {
      const suffix = `&sort=${sort}&q=${encodeURIComponent(search)}`;
      const a = await socialRequest<Feed>(`feed?section=manual${suffix}`);
      if (request !== feedRequest.current) return;
      setFeed(a);
    } catch (error) {
      if (request === feedRequest.current) throw error;
    } finally {
      if (request === feedRequest.current) setLoading(false);
    }
  }, [sort, search]);
  const run = useCallback((fn: () => Promise<unknown>) => {
    setBusy(true);
    setMessage("");
    setError(false);
    void fn()
      .catch((e) => {
        setError(true);
        setMessage(e instanceof Error ? e.message : "Something went wrong");
      })
      .finally(() => setBusy(false));
  }, []);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const c = await socialRequest<Config>("config");
      if (!alive) return;
      setConfig(c);
      const inside = await detectMiniAppContext(sdk.isInMiniApp.bind(sdk));
      if (!alive) return;
      setMini(inside);
      configureAppSurface(inside ? "farcaster-miniapp" : "web");
      if (inside) {
        configureFarcasterWallet(async () => {
          const provider = await sdk.wallet.getEthereumProvider();
          if (!provider) throw new Error("Wallet unavailable");
          return provider;
        });
        await sdk.actions.ready();
        try {
          const { token } = await sdk.quickAuth.getToken();
          await verifyFarcasterQuickAuth(token);
        } catch {
          /* User may sign in explicitly. */
        }
      } else await restoreWebWallet().catch(() => null);
      await refreshMe();
      const s = await loadAppSession();
      if (s.authenticated) {
        await socialRequest("visit", {});
        await socialRequest("refresh-evidence", {}).catch(() => undefined);
        await refreshMe();
      }
    })().catch((e) => {
      setError(true);
      setMessage(e.message);
    });
    return () => {
      alive = false;
    };
  }, [refreshMe]);
  useEffect(() => {
    void loadFeed().catch((e) => {
      setError(true);
      setMessage(e.message);
    });
    const handle = () => void loadFeed().catch(() => undefined);
    window.addEventListener("social-refresh", handle);
    return () => {
      ++feedRequest.current;
      window.removeEventListener("social-refresh", handle);
    };
  }, [loadFeed]);
  useEffect(() => {
    if (page !== "leaderboard") return;
    let cancelled = false;
    setLeadersLoading(true);
    void socialRequest<{ members: typeof leaders }>(
      `leaderboard?range=${range}`,
    )
      .then((r) => {
        if (!cancelled) setLeaders(r.members);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(true);
          setMessage(e.message);
        }
      })
      .finally(() => {
        if (!cancelled) setLeadersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, range]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const previousRestoration = history.scrollRestoration;
    history.scrollRestoration = "manual";
    const sync = () => {
      const sequence = ++routeSequence.current;
      updatePage(routePage());
      setComposerOpen(false);
      setCasts(null);
      setQuote(null);
      setAccountAnchor(null);
      const id = location.pathname.match(/\/post\/([^/]+)/)?.[1];
      const restore = () =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            window.scrollTo({
              top: history.state?.socialScroll ?? 0,
              behavior: "instant",
            }),
          ),
        );
      if (id)
        void socialRequest<{ post: SocialPost; comments: Comment[] }>(
          `post/${encodeURIComponent(id)}`,
        )
          .then((data) => {
            if (sequence === routeSequence.current) {
              setDetail(data);
              restore();
            }
          })
          .catch((e) => {
            if (sequence === routeSequence.current) {
              setError(true);
              setMessage(e.message);
            }
          });
      else {
        setDetail(null);
        restore();
      }
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => {
      ++routeSequence.current;
      history.scrollRestoration = previousRestoration;
      window.removeEventListener("popstate", sync);
    };
  }, []);
  async function connected() {
    setConnect(false);
    await refreshMe();
    if (composeAfterLogin.current) {
      composeAfterLogin.current = false;
      setComposerOpen(true);
    }
    await socialRequest("visit", {});
    await socialRequest("refresh-evidence", {});
    await refreshMe();
  }
  function requireMember() {
    if (me) return true;
    setConnect(true);
    return false;
  }
  async function submit(source: string, castHash?: string, quoteId?: string) {
    if (!requireMember()) return;
    const payload = pending.current ?? {
      operationId: crypto.randomUUID(),
      source,
      text,
      castHash,
      quoteId,
    };
    pending.current = payload;
    await socialRequest("publish", payload);
    pending.current = null;
    setText("");
    setCasts(null);
    setComposerOpen(false);
    setMessage("Your post is in the feed.");
    await Promise.all([loadFeed(), refreshMe()]);
  }
  async function compose(media = false) {
    if (!requireMember()) return;
    if (!mini) {
      await openAppUrl(config!.config.miniAppUrl);
      return;
    }
    if (me?.evidence.signer && !media) {
      await submit("signer");
      return;
    }
    const result = await sdk.actions.composeCast({ text });
    if (result?.cast) await submit("cast", result.cast.hash);
  }
  async function action(post: SocialPost, kind: string) {
    if (!requireMember()) return;
    if (kind === "quote") {
      setMessage("");
      setError(false);
      setQuote(post);
      setQuoteText("");
      return;
    }
    await socialRequest("interact", {
      postId: post.id,
      kind,
      native: !!me?.evidence.signer,
    });
    await Promise.all([loadFeed(), refreshMe()]);
    setMessage(
      me?.evidence.signer && post.cast_hash
        ? "Confirmed on Farcaster"
        : "Saved in 10X Social",
    );
  }
  async function openPost(id: string) {
    saveScroll();
    history.pushState(
      { socialNavigation: true, socialScroll: 0 },
      "",
      postUrl(id),
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  }
  async function checkin() {
    if (!requireMember()) return;
    if (!session?.walletAddress) {
      setConnect(true);
      return;
    }
    if (!config?.checkinAddress)
      throw new Error("The Base check-in contract is awaiting deployment.");
    const { provider, account } = await getConnectedProviderAndAccount();
    if (account.toLowerCase() !== session.walletAddress.toLowerCase())
      throw new Error("Reconnect your wallet to verify the selected account");
    const key = `social-checkin:${session.walletAddress}`;
    let tx = sessionStorage.getItem(key);
    if (!tx) {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x2105" }],
      });
      tx = (await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: account,
            to: config.checkinAddress,
            data: encodeFunctionData({
              abi: parseAbi(["function checkIn()"]),
              functionName: "checkIn",
            }),
            value: "0x0",
          },
        ],
      })) as string;
      sessionStorage.setItem(key, tx);
    }
    await socialRequest("checkin", { txHash: tx });
    sessionStorage.removeItem(key);
    await refreshMe();
    setMessage("Check-in confirmed. Your streak has been updated.");
  }
  const remaining = Math.max(0, (me?.member.next_post_at ?? 0) - now),
    cooldown = `${Math.floor(remaining / 3600000)}h ${Math.floor((remaining % 3600000) / 60000)}m`;
  return (
    <MiniAppShell>
      <MiniAppHeader
        appSlug="social"
        title="10X Social"
        canGoBack={!!detail || chrome.canGoBack}
        onBack={detail ? backToFeed : chrome.actions.goBack}
        onLogo={() => void chrome.actions.openHubRoot()}
        onMenu={chrome.actions.openMenu}
        onTitleMenu={() => setAccountAnchor(accountAnchor ? null : "title")}
        rightAccessory={
          <SocialAccount
            session={session}
            mini={mini}
            anchor={accountAnchor}
            onAnchor={setAccountAnchor}
            onConnect={() => setConnect(true)}
            onNavigate={setPage}
            onOnboard={() => setOnboard(true)}
            onNotifications={() =>
              run(() =>
                mini
                  ? sdk.actions.addMiniApp()
                  : openAppUrl(config!.config.miniAppUrl),
              )
            }
            onDisconnect={() =>
              run(async () => {
                await logoutAppPrincipal("all");
                setMe(null);
                setSession(null);
              })
            }
          />
        }
      />
      {chrome.isMenuRoute ? (
        <MiniAppMenuPage appSlug="social" />
      ) : (
        <main className="social-main">
          {page === "feed" && !detail && (
            <MiniAppPageHero
              title="#1 FEED FOR CRYPTO"
              subtitle={<strong>One daily post. One focused feed.</strong>}
              tagline="Earn 10X airdrops."
            />
          )}
          <nav className="social-tabs" aria-label="Social navigation">
            {(["feed", "leaderboard", "rewards"] as const).map((p) => (
              <button
                key={p}
                aria-current={page === p ? "page" : undefined}
                onClick={() => {
                  setPage(p);
                  setDetail(null);
                }}
              >
                {p === "rewards" ? "Rewards" : p[0]!.toUpperCase() + p.slice(1)}
              </button>
            ))}
          </nav>
          {message && (
            <div
              className={`social-notice ${error ? "social-error" : ""}`}
              role={error ? "alert" : "status"}
            >
              {message}
              <button aria-label="Dismiss" onClick={() => setMessage("")}>
                ×
              </button>
            </div>
          )}
          {page === "admin" ? (
            <Suspense fallback={<p>Loading administration…</p>}>
              <SocialAdmin />
            </Suspense>
          ) : detail ? (
            <>
              <button className="social-text-button" onClick={backToFeed}>
                ← Back to feed
              </button>
              <PostCard
                post={detail.post}
                me={me}
                onAction={action}
                onOpen={(id) => run(() => openPost(id))}
                run={run}
              />
              <section className="social-panel">
                <h2>Conversation</h2>
                {detail.comments.length === 0 ? (
                  <p className="social-muted">Start the conversation.</p>
                ) : (
                  detail.comments.map((c) => (
                    <div className="social-comment" key={c.id}>
                      <strong>{c.username}</strong>
                      <small>
                        {c.delivery === "confirmed" ? "Farcaster" : "10X"}
                      </small>
                      <p>
                        <TextLinks text={c.text} />
                      </p>
                    </div>
                  ))
                )}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(async () => {
                      if (!requireMember()) return;
                      await socialRequest("interact", {
                        postId: detail.post.id,
                        kind: "comment",
                        text: comment,
                        native: !!me?.evidence.signer,
                      });
                      setComment("");
                      await openPost(detail.post.id);
                      await refreshMe();
                    });
                  }}
                >
                  <textarea
                    aria-label="Comment"
                    placeholder="Add something useful…"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    maxLength={1024}
                  />
                  <button className="social-primary" disabled={busy}>
                    Comment{" "}
                    {me?.evidence.signer && detail.post.cast_hash
                      ? "on Farcaster"
                      : "in 10X"}
                  </button>
                </form>
              </section>
            </>
          ) : page === "feed" ? (
            <>
              <button className="social-compose-prompt" onClick={startCompose}>
                <SocialIcon name="write" />
                <span>
                  <strong>
                    {text ? "Continue your draft" : "Share your daily post"}
                  </strong>
                  {remaining > 0 && <small>Next in {cooldown}</small>}
                </span>
                <span className="social-prompt-action">Post</span>
              </button>
              {me && (
                <button
                  className="social-progress-strip"
                  onClick={() => {
                    setPage("rewards");
                    run(refreshMe);
                  }}
                >
                  <span>
                    Explore & earn{" "}
                    <strong>
                      {me.totals.explored}/{config?.config.limits.explore ?? 20}
                    </strong>
                  </span>
                  <span>{points(me.boost.multiplier)}× boost →</span>
                  <progress
                    value={me.totals.explored}
                    max={config?.config.limits.explore ?? 20}
                  />
                </button>
              )}
              <div className="social-search-row">
                <div className="social-search">
                  <SocialIcon name="search" />
                  <input
                    type="search"
                    aria-label="Search posts"
                    placeholder="Search posts, tokens, users..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <SocialDropdown
                  label="Order"
                  value={sort}
                  onChange={setSort}
                  options={[
                    { value: "trending", label: "Trending" },
                    { value: "newest", label: "Newest" },
                    { value: "points", label: "Points" },
                  ]}
                />
              </div>

              {loading ? (
                <div className="social-empty" role="status">
                  Finding the signal…
                </div>
              ) : feed.posts.length ? (
                feed.posts.map((p) => (
                  <PostCard
                    key={p.id}
                    post={p}
                    me={me}
                    onAction={action}
                    onOpen={(id) => run(() => openPost(id))}
                    run={run}
                  />
                ))
              ) : (
                <div className="social-empty">
                  <SocialIcon name="write" />
                  <h3>
                    {search
                      ? "No matching posts"
                      : "The next big idea starts here."}
                  </h3>
                  <p>
                    {search
                      ? "Try a different search."
                      : "Be the first to put something worth seeing into today’s feed."}
                  </p>
                </div>
              )}
              {feed.next !== null && (
                <button
                  className="social-secondary social-load"
                  onClick={() =>
                    run(async () => {
                      const request = feedRequest.current;
                      const next = await socialRequest<Feed>(
                        `feed?section=manual&sort=${sort}&offset=${feed.next}&q=${encodeURIComponent(search)}`,
                      );
                      if (request !== feedRequest.current) return;
                      setFeed({
                        posts: [...feed.posts, ...next.posts],
                        next: next.next,
                      });
                    })
                  }
                >
                  More community posts
                </button>
              )}
            </>
          ) : page === "leaderboard" ? (
            <section className="social-panel">
              <span className="social-eyebrow">CONTRIBUTION GETS NOTICED</span>
              <h1>Attention earned.</h1>
              <p className="social-muted">
                Points recognise the people who show up and help good ideas
                travel.
              </p>
              <div className="social-segments">
                {["today", "week", "all"].map((r) => (
                  <button
                    key={r}
                    aria-pressed={range === r}
                    onClick={() => setRange(r)}
                  >
                    {r === "week"
                      ? "7 days"
                      : r === "all"
                        ? "All time"
                        : "Today"}
                  </button>
                ))}
              </div>
              {leadersLoading ? (
                <p className="social-empty" role="status">
                  Loading leaderboard?
                </p>
              ) : leaders.length ? (
                leaders.map((l, i) => (
                  <div className="social-leader" key={l.id}>
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    <Avatar name={l.username} url={l.avatar} />
                    <strong>{l.username}</strong>
                    <b>
                      {points(l.points)}
                      <small>points</small>
                    </b>
                  </div>
                ))
              ) : (
                <div className="social-empty">
                  The leaderboard is waiting for its first contributors.
                </div>
              )}
            </section>
          ) : page === "rewards" ? (
            <>
              <section className="social-panel">
                <span className="social-eyebrow">YOUR ATTENTION HAS VALUE</span>
                <h1>Show up. Level up.</h1>
                {!me ? (
                  <>
                    <p>
                      Connect a wallet or Farcaster account to start earning.
                    </p>
                    <button
                      className="social-primary"
                      onClick={() => setConnect(true)}
                    >
                      Join 10X Social
                    </button>
                  </>
                ) : (
                  <>
                    <div className="social-stat-grid">
                      <div>
                        <strong>{points(me.totals.points)}</strong>
                        <span>Total points</span>
                      </div>
                      <div>
                        <strong>{points(me.boost.multiplier)}×</strong>
                        <span>Points multiplier</span>
                      </div>
                      <div>
                        <strong>{me.evidence.streak}</strong>
                        <span>Day streak</span>
                      </div>
                    </div>
                    <p className="social-muted">
                      Today: {points(me.totals.today)} points · Exploration:{" "}
                      {me.totals.explored}/{config?.config.limits.explore ?? 20}
                    </p>
                    <button
                      className="social-primary"
                      disabled={busy || !config?.checkinAddress}
                      onClick={() => run(checkin)}
                    >
                      {config?.checkinAddress
                        ? "Check in on Base"
                        : "Onchain check-in coming soon"}
                    </button>
                    <p className="social-fine">
                      One check-in per UTC day. You pay the Base network fee.
                      Posting resets separately, 24 hours after your last
                      submission.
                    </p>
                    <button
                      className="social-text-button"
                      onClick={() =>
                        run(async () => {
                          sessionStorage.removeItem(
                            `social-checkin:${session?.walletAddress}`,
                          );
                          setMessage(
                            "Saved transaction cleared. Check its status in your wallet before submitting again.",
                          );
                        })
                      }
                    >
                      Clear saved check-in transaction
                    </button>
                  </>
                )}
              </section>
              <section className="social-panel">
                <div className="social-section-head">
                  <h2>My boosts</h2>
                  <button
                    className="social-compact-button"
                    disabled={busy || !me}
                    onClick={() =>
                      run(async () => {
                        await socialRequest("refresh-evidence", {});
                        await refreshMe();
                      })
                    }
                  >
                    Refresh
                  </button>
                </div>
                <p className="social-muted">
                  Start at 1×. Add contribution and holding bonuses, up to{" "}
                  {config?.config.boosts.maximum ?? 10}×. Trending uses a
                  smaller, capped boost.
                </p>
                {config &&
                  (
                    [
                      "connection",
                      "context",
                      "notifications",
                      "signer",
                      "follow",
                      "email",
                    ] as const
                  ).map((key) => (
                    <div className="social-boost" key={key}>
                      <span>{me?.evidence[key] ? "✓" : "○"}</span>
                      <div>
                        <strong>
                          {
                            {
                              connection: "Connect Farcaster",
                              context: "Use the Farcaster mini app",
                              notifications: "Add app & enable notifications",
                              signer: "Approve cast & reaction permissions",
                              follow: "Follow @10xmeme",
                              email: "Verify your email",
                            }[key]
                          }
                        </strong>
                        <small>
                          {key === "context" && !config.contextBonusAvailable
                            ? "Host verification pending — not awarded yet"
                            : me?.evidence[key]
                              ? "Verified"
                              : "Not yet verified"}
                        </small>
                      </div>
                      <b>+{config.config.boosts[key]}×</b>
                    </div>
                  ))}
                {me && (
                  <>
                    {(
                      [
                        ["Check-in streak", me.boost.contributions.streak],
                        [
                          "Highest Warplet trait",
                          me.boost.contributions.warplets,
                        ],
                        ["Stonklets held", me.boost.contributions.stonklets],
                      ] as const
                    ).map(([label, value]) => (
                      <div className="social-boost" key={label}>
                        <div>
                          <strong>{label}</strong>
                          <small>
                            {label === "Stonklets held"
                              ? `${me.evidence.stonklets} qualifying assets · 10,000 tokens each`
                              : label === "Highest Warplet trait"
                                ? `Level ${me.evidence.warpletLevel}`
                                : `${me.evidence.streak} consecutive days`}
                          </small>
                        </div>
                        <b>+{points(value)}×</b>
                      </div>
                    ))}
                    <p className="social-fine">
                      Evidence checked{" "}
                      {me.evidenceUpdatedAt
                        ? new Date(me.evidenceUpdatedAt).toLocaleString()
                        : "not yet"}
                      . Old or unavailable evidence earns no affected bonus.
                    </p>
                  </>
                )}
              </section>
              <section className="social-panel">
                <h2>Unlock more with Farcaster</h2>
                <p className="social-muted">
                  Your wallet gets you started. Farcaster brings your identity,
                  media, notifications and a wider audience.
                </p>
                <div className="social-journey">
                  <button
                    onClick={() =>
                      run(() =>
                        openAppUrl(
                          config?.config.referralUrl ||
                            "https://farcaster.xyz/",
                        ),
                      )
                    }
                  >
                    1 · Get Farcaster <SocialIcon name="external" />
                  </button>
                  <button onClick={() => setConnect(true)}>
                    2 · Connect your identity
                  </button>
                  <button
                    onClick={() =>
                      run(() =>
                        mini
                          ? sdk.actions.addMiniApp()
                          : openAppUrl(config!.config.miniAppUrl),
                      )
                    }
                  >
                    3 · Add 10X Social & notifications
                  </button>
                  <button
                    disabled={!config?.signerConfigured || busy}
                    onClick={() =>
                      run(async () => {
                        if (!requireMember()) return;
                        const result = await socialRequest<{
                          url?: string;
                          status: string;
                        }>("signer", {});
                        if (result.url) await openAppUrl(result.url);
                        else setMessage(`Signer: ${result.status}`);
                      })
                    }
                  >
                    4 ·{" "}
                    {config?.signerConfigured
                      ? "Approve direct casting & reactions"
                      : "Signer approval coming soon"}
                  </button>
                  <button
                    onClick={() =>
                      run(() =>
                        openAppUrl(
                          `https://farcaster.xyz/~/profiles/${config?.config.followFid ?? 1313340}`,
                        ),
                      )
                    }
                  >
                    5 · Follow 10X <SocialIcon name="external" />
                  </button>
                </div>
                {me &&
                  session?.farcasterFid &&
                  session.walletAddress &&
                  !session.identitiesLinked && (
                    <button
                      className="social-secondary"
                      onClick={() =>
                        run(async () => {
                          await linkCurrentWalletAndIdentity(
                            session.walletAddress!,
                          );
                          await refreshMe();
                        })
                      }
                    >
                      Link this wallet to my Farcaster identity
                    </button>
                  )}
                {me?.evidence.balances && (
                  <details className="social-fine">
                    <summary>Verified token holdings</summary>
                    {me.evidence.balances.map((asset) => (
                      <p key={asset.name}>
                        {asset.qualifies ? "Qualified:" : "Below threshold:"}{" "}
                        {asset.name}
                      </p>
                    ))}
                  </details>
                )}
                {me?.evidence.warnings?.map((warning) => (
                  <p className="social-fine" key={warning}>
                    {warning}
                  </p>
                ))}
                <EmailWaitlistCta
                  authenticatedSession={session?.authenticated}
                  viewerFid={session?.farcasterFid ?? null}
                  actionSessionToken={session?.actionSessionToken ?? null}
                />
              </section>
              {me && (
                <section className="social-panel">
                  <h2>Recent earnings</h2>
                  {me.history.map((h, i) => (
                    <div className="social-history" key={i}>
                      <span>
                        {h.action}
                        <small>
                          {h.day} · {points(h.multiplier)}×
                        </small>
                      </span>
                      <strong>+{points(h.points)}</strong>
                    </div>
                  ))}
                  <button
                    className="social-text-button"
                    onClick={() =>
                      run(async () => {
                        await logoutAppPrincipal("all");
                        setMe(null);
                        setSession(null);
                      })
                    }
                  >
                    Sign out
                  </button>
                </section>
              )}
            </>
          ) : (
            <section className="social-panel social-about">
              <span className="social-eyebrow">#1 FEED FOR CRYPTO</span>
              <h1>
                Distribution rules
                <br />
                everything around me.
              </h1>
              <h2>One daily post. One focused feed.</h2>
              <p>
                One submission every 24 hours gives every member a place to
                bring their best. News, alpha, ideas and original creation,
                together in one feed.
              </p>
              <h2>Earn attention through contribution.</h2>
              <p>
                Explore thoughtfully, join conversations and help strong posts
                travel. Holdings and streaks add transparent, capped boosts.
              </p>
              <h2>Start with a wallet. Grow with Farcaster.</h2>
              <p>
                Post text and links directly on the web. Open 10X Social in
                Farcaster for image and video creation. Approve a signer to cast
                and react without leaving the feed.
              </p>
              <h2>Points today. More to come.</h2>
              <p>
                Points and exploration progress are live when you participate.
                Attention Token allocations and claims are future features, not
                current token entitlements.
              </p>
              <button
                className="social-primary"
                onClick={() => {
                  setOnboard(true);
                }}
              >
                Explore the introduction
              </button>
              <p className="social-manifesto">
                D.R.E.A.M.
                <br />
                <strong>Attention is KING.</strong>
              </p>
            </section>
          )}
        </main>
      )}
      {!chrome.isMenuRoute && <SiteFooter />}
      {composerOpen && !connect && (
        <SocialModal
          title="Your daily spotlight"
          busy={busy}
          onClose={() => setComposerOpen(false)}
          footer={
            <>
              {" "}
              <div className="social-compose-bottom">
                <span>
                  {text.length}/{mini ? 1024 : 2000}
                </span>
                <button
                  className="social-primary"
                  disabled={
                    busy ||
                    remaining > 0 ||
                    (!text.trim() && (!mini || !!me?.evidence.signer))
                  }
                  onClick={() =>
                    run(() => (mini ? compose() : submit("local")))
                  }
                >
                  {mini ? "Cast & submit" : "Post to 10X"}
                  {mini && <SocialIcon name="external" />}
                </button>
              </div>
            </>
          }
        >
          <p className="social-muted">
            {remaining
              ? `Your next post is available in ${cooldown}.`
              : "One original post or quote every 24 hours."}
          </p>
          <textarea
            aria-label="Your post"
            placeholder="What deserves the community’s attention?"
            value={text}
            maxLength={mini ? 1024 : 2000}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="social-compose-links">
            <button onClick={() => run(() => compose(true))}>
              {mini
                ? "Photo / video via Farcaster"
                : "Open Farcaster for photos & video"}
              <SocialIcon name="external" />
            </button>
            {Boolean(session?.farcasterFid) && (
              <button
                onClick={() =>
                  run(async () => {
                    const result = await socialRequest<{
                      casts: NonNullable<typeof casts>;
                    }>("casts");
                    setComposerOpen(false);
                    setCasts(result.casts);
                  })
                }
              >
                Choose a recent cast
              </button>
            )}
          </div>
          {me?.operations
            .filter((o) => o.state !== "complete")
            .map((o) => (
              <div className="social-notice" key={o.id}>
                <span>Unfinished submission: {o.error || "processing"}</span>
                <button
                  onClick={() =>
                    run(async () => {
                      const original = JSON.parse(o.payload_json);
                      await socialRequest("publish", {
                        operationId: o.id,
                        ...original,
                      });
                      pending.current = null;
                      await Promise.all([loadFeed(), refreshMe()]);
                    })
                  }
                >
                  Retry
                </button>
              </div>
            ))}
          {message && (
            <p
              className={`social-notice ${error ? "social-error" : ""}`}
              role={error ? "alert" : "status"}
            >
              {message}
            </p>
          )}
        </SocialModal>
      )}
      <WebConnectModal
        open={connect}
        onClose={() => {
          setConnect(false);
          composeAfterLogin.current = false;
        }}
        identityConnected={!!session?.farcasterFid}
        farcasterMiniAppUrl={config?.config.miniAppUrl}
        onWalletConnected={() => run(connected)}
        farcasterControl={
          <FarcasterSignInControl
            connected={!!session?.farcasterFid}
            onAuthenticated={() => run(connected)}
          />
        }
      />
      {onboard && (
        <SocialOnboarding
          onDone={() => {
            setOnboard(false);
            try {
              localStorage.setItem("social-onboarding-v1", "1");
            } catch {
              /* Completion still applies to this session. */
            }
          }}
        />
      )}
      {casts && (
        <SocialModal
          title="Choose a recent cast"
          busy={busy}
          onClose={() => {
            setCasts(null);
            setComposerOpen(true);
          }}
        >
          <p>
            Original casts and quotes only. Choose the one worth a spotlight.
          </p>
          {casts.length ? (
            casts.map((c) => (
              <button
                className="social-cast-choice"
                disabled={busy || remaining > 0}
                key={c.hash}
                onClick={() => run(() => submit("cast", c.hash))}
              >
                {c.text || "Media post"}
                <small>{new Date(c.timestamp).toLocaleString()}</small>
              </button>
            ))
          ) : (
            <p>No eligible casts found.</p>
          )}
        </SocialModal>
      )}
      {quote && (
        <SocialModal
          title="Quote post"
          busy={busy}
          onClose={() => setQuote(null)}
          footer={
            <>
              {" "}
              <button
                className="social-primary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await socialRequest("interact", {
                      postId: quote.id,
                      kind: "quote",
                      text: quoteText,
                      native: !!me?.evidence.signer,
                    });
                    setQuote(null);
                    await refreshMe();
                    setMessage("Quote saved. It does not use your feed slot.");
                  })
                }
              >
                {me?.evidence.signer && quote.cast_hash
                  ? "Quote on Farcaster"
                  : "Save quote in 10X"}
              </button>
              <button
                className="social-secondary"
                disabled={busy || remaining > 0}
                onClick={() =>
                  run(async () => {
                    let castHash: string | undefined;
                    if (mini && !me?.evidence.signer) {
                      const composed = await sdk.actions.composeCast({
                        text: quoteText,
                        embeds: [
                          quote.cast_hash
                            ? `https://farcaster.xyz/${quote.username}/${quote.cast_hash}`
                            : postUrl(quote.id),
                        ],
                      });
                      if (!composed?.cast) return;
                      castHash = composed.cast.hash;
                    }
                    const payload = pending.current ?? {
                      operationId: crypto.randomUUID(),
                      source: castHash
                        ? "cast"
                        : mini && me?.evidence.signer
                          ? "signer"
                          : "local",
                      text: quoteText,
                      quoteId: quote.id,
                      castHash,
                    };
                    pending.current = payload;
                    await socialRequest("publish", payload);
                    pending.current = null;
                    setQuote(null);
                    await Promise.all([loadFeed(), refreshMe()]);
                  })
                }
              >
                Use my feed slot for this quote
              </button>
            </>
          }
        >
          {message && error && (
            <p className="social-notice social-error" role="alert">
              {message}
            </p>
          )}
          <blockquote>{quote.text}</blockquote>
          <textarea
            aria-label="Quote text"
            value={quoteText}
            onChange={(e) => setQuoteText(e.target.value)}
            maxLength={1024}
          />
        </SocialModal>
      )}
    </MiniAppShell>
  );
}

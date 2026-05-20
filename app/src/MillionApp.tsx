import { useEffect, useMemo, useState } from "react";
import sdk from "@farcaster/miniapp-sdk";
import { Text } from "@neynar/ui/typography";
import {
  MiniAppHeader,
  MiniAppMenuPage,
  getHeaderTitle,
  useMiniAppChrome,
} from "./miniAppChrome.tsx";
import MiniAppShell from "./MiniAppShell";
import { hapticError, hapticPrimaryTap, hapticSuccess, hapticTap } from "./haptics";

type MillionAction = {
  id: number;
  slug: string;
  name: string;
  description: string;
  appAction: string | null;
  url: string | null;
  verificationMethod: string;
  entryValue: number;
  completed: boolean;
  verification: string | null;
  previouslyCompleted?: boolean;
};

type EntryAvatar = {
  fid: number;
  username: string;
  pfpUrl: string;
};

type TopReferrer = EntryAvatar & {
  referrals: number;
};

type MillionStatus = {
  giveawayMonth: string;
  hasEntry: boolean;
  email: string | null;
  userEntries: number;
  totalEntries: number;
  daysLeft: number;
  referralCount: number;
  referralBonusEntries: number;
  entryAvatars: EntryAvatar[];
  topReferrers: TopReferrer[];
  actionSessionToken: string | null;
  actions: MillionAction[];
};

type WarpletStatus = {
  actionSessionToken?: string | null;
};

type PromoCard = {
  id: "rare" | "builders" | "airdrop";
  title: string;
  subtitle: string;
  imageUrl: string;
  urgency: string;
  ctas: Array<{
    label: string;
    kind: "external" | "enter" | "x" | "farcaster";
    href?: string;
  }>;
};

const FARCASTER_JOIN_URL = "https://farcaster.xyz/~/code/RUZLHN";
const STATIC_DISCLAIMER_PRICE = "$ABC";

function isMillionHost(): boolean {
  return window.location.hostname.includes("million");
}

function getMillionRootPath(): string {
  return isMillionHost() ? "/" : "/million";
}

function getRouteMode(): "landing" | "enter" {
  const cleanPath = window.location.pathname.replace(/\/+$/, "") || "/";
  if (cleanPath === "/entry") {
    window.history.replaceState(window.history.state, "", "/enter");
    return "enter";
  }
  if (cleanPath === "/million/entry") {
    window.history.replaceState(window.history.state, "", "/million/enter");
    return "enter";
  }
  return cleanPath === "/enter" || cleanPath === "/million/enter" ? "enter" : "landing";
}

function buildMillionUrl(fid: number | null): string {
  const base = "https://million.10x.meme/";
  return fid ? `${base}?fid=${fid}` : base;
}

function buildPromoCards(): PromoCard[] {
  return [
    {
      id: "rare",
      title: "💎 Rare 1-of-1 NFT",
      subtitle: "30 Day Dutch Auction. $1,000,000 → $100.",
      imageUrl: "https://millions.10x.meme/WPLTX1_1000x1000.jpg",
      urgency: "⚠️ Price drops $1,000,000 → $999,000 in X minutes",
      ctas: [
        {
          label: "About $1M Warplet + 1 Year of Attention",
          kind: "external",
          href: "https://link.10x.meme/1mwarplet",
        },
      ],
    },
    {
      id: "builders",
      title: "🔥 Fuel for Builders",
      subtitle: "50% of Sale = USDC Prize. $500,000 → $50.",
      imageUrl: "https://warplets.10x.meme/1.jpg",
      urgency: "🤑 Current Prize Pool*: $10,000 x 5 Winners.",
      ctas: [
        {
          label: "Enter Now (Free, Fast, Easy)",
          kind: "enter",
        },
      ],
    },
    {
      id: "airdrop",
      title: "10X Warplets 💚 The Warplets",
      subtitle: "20% of Sale = Buy & Airdrop NFTs.",
      imageUrl: "https://warplets.10x.meme/2.jpg",
      urgency: "🎁 Current Airdrop**: $10,000 = 500 10X Warplets + $10,000 = 5000 The Warplets.",
      ctas: [
        {
          label: "Spread the hype on X",
          kind: "x",
        },
        {
          label: "Spread the hype on Farcaster",
          kind: "farcaster",
        },
      ],
    },
  ];
}

function ActionCheckIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12.5L10 17L19 8"
        stroke="currentColor"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AvatarStack({ avatars, label }: { avatars: EntryAvatar[]; label: string }) {
  return (
    <div className="mt-4 flex items-center justify-center gap-3">
      <Text className="text-xs font-bold uppercase tracking-wide text-emerald-200/80">{label}</Text>
      <div className="flex -space-x-2">
        {avatars.slice(0, 10).map((avatar) => (
          <button
            key={`${avatar.fid}-${avatar.pfpUrl}`}
            type="button"
            className="h-8 w-8 overflow-hidden rounded-full border border-emerald-300/70 bg-black"
            onClick={() => sdk.actions.viewProfile({ fid: avatar.fid }).catch(() => {})}
            title={avatar.username}
          >
            <img src={avatar.pfpUrl} alt={avatar.username} className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
    </div>
  );
}

function PromoSection({
  card,
  referralMillionUrl,
  entryAvatars,
  onEnter,
}: {
  card: PromoCard;
  referralMillionUrl: string;
  entryAvatars: EntryAvatar[];
  onEnter: () => void;
}) {
  const runCta = async (cta: PromoCard["ctas"][number]) => {
    await hapticPrimaryTap();
    if (cta.kind === "external" && cta.href) {
      await sdk.actions.openUrl(cta.href);
      return;
    }
    if (cta.kind === "enter") {
      onEnter();
      return;
    }
    if (cta.kind === "x") {
      const text = `🟢 $1M Warplet\n\nDon't miss out.\n\n1️⃣ Join Farcaster: ${FARCASTER_JOIN_URL}\n2️⃣ Visit mini-app: ${referralMillionUrl}`;
      const intentUrl = `https://x.com/intent/post?${new URLSearchParams({
        text,
        url: "",
        hashtags: "1MWarplet",
        via: "10XMemeX",
      }).toString()}`;
      await sdk.actions.openUrl(intentUrl);
      return;
    }
    if (cta.kind === "farcaster") {
      await sdk.actions.composeCast({
        text: `🟢 $1M Warplet\n\nDon't miss out.\n\nVisit mini-app: ${referralMillionUrl}`,
        embeds: [referralMillionUrl],
        channelKey: "10xmeme",
      } as Parameters<typeof sdk.actions.composeCast>[0] & { channelKey: string });
    }
  };

  return (
    <section className="w-full border-t border-emerald-400/20 px-4 py-7">
      <div className="mx-auto max-w-md">
        <div className="overflow-hidden rounded-2xl border border-emerald-300/30 bg-black/70">
          <img src={card.imageUrl} alt={card.title} className="aspect-square w-full object-cover" />
          <div className="p-5 text-center">
            <Text className="text-2xl font-black text-emerald-300">{card.title}</Text>
            <Text className="mt-2 text-sm text-emerald-50/90">{card.subtitle}</Text>
            <div className="mt-4 space-y-2">
              {card.ctas.map((cta) => (
                <button
                  key={`${card.id}-${cta.label}`}
                  type="button"
                  onClick={() => runCta(cta).catch(() => {})}
                  className="w-full rounded-xl bg-emerald-300 px-4 py-3 text-sm font-black text-black"
                >
                  {cta.label}
                </button>
              ))}
            </div>
            <Text className="mt-3 text-xs font-bold text-yellow-200">{card.urgency}</Text>
            {card.id === "builders" && entryAvatars.length > 0 && (
              <AvatarStack avatars={entryAvatars} label="Entries:" />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function StatBox({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl border border-emerald-300/30 bg-black/60 px-3 py-4 text-center">
      <Text className="text-2xl font-black text-emerald-300">{value}</Text>
      <Text className="mt-1 text-[11px] font-bold uppercase tracking-wide text-emerald-100/70">{label}</Text>
    </div>
  );
}

export default function MillionApp() {
  const [routeMode, setRouteMode] = useState<"landing" | "enter">(() => getRouteMode());
  const [showOpenInFarcaster, setShowOpenInFarcaster] = useState(false);
  const [showAddAppPrompt, setShowAddAppPrompt] = useState(false);
  const [notificationsOnlyPrompt, setNotificationsOnlyPrompt] = useState(false);
  const [fid, setFid] = useState<number | null>(null);
  const [username, setUsername] = useState<string>("");
  const [actionSessionToken, setActionSessionToken] = useState("");
  const [status, setStatus] = useState<MillionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState("");
  const [pendingVerify, setPendingVerify] = useState<Record<string, boolean>>({});
  const [rejectedVerify, setRejectedVerify] = useState<Record<string, boolean>>({});
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailValue, setEmailValue] = useState("");
  const [emailSubmitting, setEmailSubmitting] = useState(false);
  const [emailMessage, setEmailMessage] = useState("");
  const { isMenuRoute, canGoBack, actions } = useMiniAppChrome("million");

  const promoCards = useMemo(() => buildPromoCards(), []);
  const referralMillionUrl = useMemo(() => buildMillionUrl(fid), [fid]);
  const searchParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const forceEntryAvatars = searchParams.get("entries") === "1";
  const referrerFid = searchParams.get("fid");

  const enterPath = `${getMillionRootPath().replace(/\/$/, "")}/enter`.replace(/^\/enter$/, "/enter");
  const goToEnter = () => {
    window.history.pushState(window.history.state, "", enterPath);
    setRouteMode("enter");
  };

  const loadMillionStatus = async (viewerFid: number | null, token: string | null) => {
    const params = new URLSearchParams();
    if (viewerFid) params.set("fid", String(viewerFid));
    if (token) params.set("sessionToken", token);
    if (forceEntryAvatars) params.set("entries", "1");
    const response = await fetch(`/api/million-status?${params.toString()}`);
    if (!response.ok) throw new Error(await response.text());
    const data = (await response.json()) as MillionStatus;
    setStatus(data);
    setActionSessionToken(data.actionSessionToken ?? token ?? "");
    if (data.email && !emailValue) setEmailValue(data.email);
    return data;
  };

  useEffect(() => {
    let shouldCallReady = false;

    const init = async () => {
      try {
        const inMiniApp =
          typeof sdk.isInMiniApp === "function" ? await sdk.isInMiniApp() : true;
        if (!inMiniApp) {
          setShowOpenInFarcaster(true);
          await loadMillionStatus(null, null);
          return;
        }

        shouldCallReady = true;
        const context = await sdk.context;
        const viewerFid = context.user.fid;
        setFid(viewerFid);
        setUsername(context.user.username ?? "");

        const warpletStatusRes = await fetch("/api/warplet-status", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            fid: viewerFid,
            referrerFid: referrerFid && /^\d+$/.test(referrerFid) ? Number(referrerFid) : undefined,
          }),
        });
        const warpletStatus = warpletStatusRes.ok
          ? ((await warpletStatusRes.json()) as WarpletStatus)
          : null;
        const token = warpletStatus?.actionSessionToken ?? null;
        if (token) setActionSessionToken(token);

        const data = await loadMillionStatus(viewerFid, token);
        if (data.hasEntry && getRouteMode() === "landing") {
          goToEnter();
        }

        const shouldPromptAddApp =
          !context.client.added || !context.client.notificationDetails;
        setShowAddAppPrompt(shouldPromptAddApp);
        setNotificationsOnlyPrompt(Boolean(context.client.added && !context.client.notificationDetails));
      } catch (err) {
        console.error("Million app init error:", err);
        const message = err instanceof Error ? err.message : String(err);
        const normalized = message.toLowerCase();
        if (
          normalized.includes("context is undefined") ||
          normalized.includes("can't access property \"user\"") ||
          normalized.includes("cannot read properties of undefined")
        ) {
          setShowOpenInFarcaster(true);
        } else {
          setActionError(message);
        }
      } finally {
        setLoading(false);
        if (shouldCallReady) sdk.actions.ready();
      }
    };

    init();
  }, []);

  useEffect(() => {
    const onPop = () => setRouteMode(getRouteMode());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const refreshStatus = async () => {
    if (!fid) return;
    await loadMillionStatus(fid, actionSessionToken || null);
  };

  const submitEmail = async () => {
    if (!fid || emailSubmitting) return;
    if (!emailValue.trim()) {
      setEmailMessage("Please enter a valid email.");
      return;
    }
    setEmailSubmitting(true);
    setEmailMessage("");
    try {
      const response = await fetch("/api/email/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: emailValue.trim(),
          fid,
          username,
          campaign: "million",
          sessionToken: actionSessionToken || undefined,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      const payload = (await response.json()) as { alreadyVerified?: boolean; verificationEmailSent?: boolean };
      if (payload.alreadyVerified) {
        await verifyAction("million-enter-email");
        setEmailMessage("Email already verified. Your giveaway entry is accepted.");
      } else {
        setPendingVerify((prev) => ({ ...prev, "million-enter-email": true }));
        setEmailMessage(payload.verificationEmailSent
          ? "Verification sent. Check your email before your entry is accepted."
          : "Subscribed. Verify your email before your entry is accepted.");
      }
      await refreshStatus();
    } catch (err) {
      void hapticError();
      setEmailMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setEmailSubmitting(false);
    }
  };

  const verifyAction = async (slug: string) => {
    if (!fid) return;
    try {
      const response = await fetch("/api/million-action-complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actionSlug: slug,
          fid,
          sessionToken: actionSessionToken || undefined,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { reason?: string } | null;
        throw new Error(payload?.reason ?? "Action is not verified yet.");
      }
      setPendingVerify((prev) => ({ ...prev, [slug]: false }));
      setRejectedVerify((prev) => ({ ...prev, [slug]: false }));
      await hapticSuccess();
      await refreshStatus();
    } catch (err) {
      void hapticError();
      setPendingVerify((prev) => ({ ...prev, [slug]: false }));
      setRejectedVerify((prev) => ({ ...prev, [slug]: true }));
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const runAction = async (action: MillionAction) => {
    if (action.completed) return;
    await hapticTap();
    if (action.slug === "million-enter-email") {
      setEmailValue(status?.email ?? emailValue);
      setShowEmailModal(true);
      return;
    }
    setRejectedVerify((prev) => ({ ...prev, [action.slug]: false }));
    setPendingVerify((prev) => ({ ...prev, [action.slug]: true }));

    if (action.slug === "million-cast") {
      await sdk.actions.composeCast({
        text: `🟢 $1M Warplet\n\nDon't miss out.\n\nVisit mini-app: ${referralMillionUrl}`,
        embeds: [referralMillionUrl],
        channelKey: "10xmeme",
      } as Parameters<typeof sdk.actions.composeCast>[0] & { channelKey: string }).catch(() => {});
      return;
    }
    if (action.slug === "million-tweet") {
      const text = `🟢 $1M Warplet\n\nDon't miss out.\n\n1️⃣ Join Farcaster: ${FARCASTER_JOIN_URL}\n2️⃣ Visit mini-app: ${referralMillionUrl}`;
      const intentUrl = `https://x.com/intent/post?${new URLSearchParams({
        text,
        url: "",
        hashtags: "1MWarplet",
        via: "10XMemeX",
      }).toString()}`;
      await sdk.actions.openUrl(intentUrl).catch(() => {});
      return;
    }
    if (action.slug === "million-follow-fc-10xmeme") {
      await sdk.actions.viewProfile({ fid: 1313340 }).catch(() => {});
      window.setTimeout(() => verifyAction(action.slug), 5000);
      return;
    }
    if (action.slug === "million-follow-fc-10xchris") {
      await sdk.actions.viewProfile({ fid: 1129138 }).catch(() => {});
      window.setTimeout(() => verifyAction(action.slug), 5000);
      return;
    }
    if (action.url) {
      await sdk.actions.openUrl(action.url).catch(() => {});
    }
  };

  const renderLanding = () => (
    <>
      <div className="mx-auto w-full max-w-md px-4 pb-3 pt-7 text-center">
        <Text className="text-3xl font-black text-emerald-300">$1M Warplet</Text>
        <Text className="mt-2 text-sm text-emerald-50/80">
          One rare auction. One monthly builder giveaway. One very green machine.
        </Text>
        {showOpenInFarcaster && (
          <Text className="mt-4 text-xs text-yellow-200">
            Open this mini app inside Farcaster to enter and track actions.
          </Text>
        )}
      </div>
      {promoCards.map((card) => (
        <PromoSection
          key={card.id}
          card={card}
          referralMillionUrl={referralMillionUrl}
          entryAvatars={status?.entryAvatars ?? []}
          onEnter={goToEnter}
        />
      ))}
      <Disclaimer />
    </>
  );

  const renderEntryPage = () => {
    const actionsList = status?.actions ?? [];
    return (
      <>
        <section className="px-4 py-7">
          <div className="mx-auto max-w-md">
            <Text className="text-center text-3xl font-black text-emerald-300">🔥 Fuel for Builders</Text>
            <Text className="mt-2 text-center text-sm font-bold text-emerald-50/80">Verified Actions 👉 More Entries</Text>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <StatBox value={status?.userEntries ?? 0} label="Your Entries" />
              <StatBox value={status?.totalEntries ?? 0} label="Total Entries" />
              <StatBox value={status?.daysLeft ?? 0} label="Days Left" />
            </div>
            <div className="mt-5 space-y-3">
              {actionsList.map((action) => {
                const pending = pendingVerify[action.slug] === true;
                const showVerify =
                  pending ||
                  (Boolean(action.previouslyCompleted) && rejectedVerify[action.slug] !== true) ||
                  (action.slug === "million-enter-email" && Boolean(status?.email) && !action.completed);
                return (
                  <div key={action.slug} className="rounded-xl border border-emerald-300/25 bg-black/65 p-3">
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <Text className="text-sm font-black text-emerald-100">{action.name}</Text>
                        <Text className="mt-1 text-xs text-emerald-50/60">{action.description}</Text>
                      </div>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          if (showVerify) {
                            verifyAction(action.slug).catch(() => {});
                          } else {
                            runAction(action).catch(() => {});
                          }
                        }}
                        className="flex h-11 min-w-14 items-center justify-center rounded-xl bg-emerald-300 px-3 text-sm font-black text-black disabled:bg-gray-600 disabled:text-white"
                      >
                        {action.completed ? <ActionCheckIcon /> : pending ? "..." : showVerify ? "Verify" : `+${action.entryValue}`}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 rounded-2xl border border-emerald-300/25 bg-black/60 p-4">
              <Text className="text-lg font-black text-emerald-300">Earn Referral Points</Text>
              <Text className="mt-2 text-sm text-emerald-50/75">
                Share your $1M Warplet referral link. Every referral earns 1 bonus entry, up to 10 bonus entries.
              </Text>
              <input
                readOnly
                value={referralMillionUrl}
                className="mt-3 w-full rounded-xl border border-emerald-300/25 bg-black px-3 py-2 text-xs text-emerald-50"
              />
              <Text className="mt-2 text-xs font-bold text-emerald-200">
                Your referrals: {status?.referralCount ?? 0} • Bonus entries: {status?.referralBonusEntries ?? 0}/10
              </Text>
            </div>

            <div className="mt-6 rounded-2xl border border-emerald-300/25 bg-black/60 p-4">
              <Text className="text-lg font-black text-emerald-300">Top Referrers</Text>
              <div className="mt-3 space-y-2">
                {(status?.topReferrers ?? []).slice(0, 10).map((referrer, index) => (
                  <button
                    key={referrer.fid}
                    type="button"
                    onClick={() => sdk.actions.viewProfile({ fid: referrer.fid }).catch(() => {})}
                    className="flex w-full items-center gap-3 rounded-xl bg-emerald-950/35 px-3 py-2 text-left"
                  >
                    <Text className="w-6 text-sm font-black text-emerald-300">#{index + 1}</Text>
                    {referrer.pfpUrl && <img src={referrer.pfpUrl} alt={referrer.username} className="h-8 w-8 rounded-full object-cover" />}
                    <Text className="flex-1 text-sm font-bold text-emerald-50">{referrer.username}</Text>
                    <Text className="text-sm font-black text-emerald-300">{referrer.referrals}</Text>
                  </button>
                ))}
                {(status?.topReferrers ?? []).length === 0 && (
                  <Text className="text-sm text-emerald-50/60">No referrals yet.</Text>
                )}
              </div>
            </div>
          </div>
        </section>
        {promoCards.filter((card) => card.id !== "builders").map((card) => (
          <PromoSection
            key={`repeat-${card.id}`}
            card={card}
            referralMillionUrl={referralMillionUrl}
            entryAvatars={status?.entryAvatars ?? []}
            onEnter={goToEnter}
          />
        ))}
        <section className="px-4 py-7">
          <div className="mx-auto max-w-md rounded-2xl border border-emerald-300/25 bg-black/60 p-4">
            <Text className="text-lg font-black text-emerald-300">Terms and Conditions</Text>
            <Text className="mt-2 text-xs leading-relaxed text-emerald-50/65">
              Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer non nibh vitae neque
              consequat facilisis. Entries are subject to verification, availability, eligibility,
              and final campaign rules to be published before winners are contacted.
            </Text>
          </div>
        </section>
      </>
    );
  };

  const handleConfirmAddAppPrompt = async () => {
    setShowAddAppPrompt(false);
    try {
      await hapticPrimaryTap();
      await sdk.actions.addMiniApp();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <MiniAppShell>
      <div className="relative z-10 w-full">
        <MiniAppHeader
          appSlug="million"
          title={routeMode === "enter" ? "Enter Giveaway" : getHeaderTitle("million", isMenuRoute)}
          canGoBack={canGoBack || routeMode === "enter"}
          onBack={routeMode === "enter" ? () => {
            window.history.pushState(window.history.state, "", getMillionRootPath());
            setRouteMode("landing");
          } : actions.goBack}
          onLogo={actions.openHubRoot}
          onMenu={actions.openMenu}
        />

        {isMenuRoute ? (
          <MiniAppMenuPage appSlug="million" />
        ) : loading ? (
          <div className="px-4 py-10 text-center">
            <Text className="text-sm font-bold text-emerald-300">Loading $1M Warplet...</Text>
          </div>
        ) : routeMode === "enter" ? renderEntryPage() : renderLanding()}
      </div>

      {showAddAppPrompt && !showOpenInFarcaster && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 pb-8">
          <div className="w-full max-w-sm rounded-2xl border border-emerald-300/40 bg-black px-5 py-6 shadow-2xl">
            <Text className="text-center text-lg font-black text-emerald-300">
              {notificationsOnlyPrompt ? "Enable Notifications" : "Add $1M Warplet"}
            </Text>
            <Text className="mt-3 text-center text-sm text-emerald-50/80">
              Get auction, giveaway, and winner updates inside Farcaster.
            </Text>
            <button
              type="button"
              onClick={handleConfirmAddAppPrompt}
              className="mt-5 w-full rounded-xl bg-emerald-300 py-3 font-black text-black"
            >
              {notificationsOnlyPrompt ? "Enable Notifications" : "Add Mini App"}
            </button>
            <button
              type="button"
              onClick={() => setShowAddAppPrompt(false)}
              className="mt-3 w-full rounded-xl py-2 text-sm text-emerald-50/60"
            >
              Maybe later
            </button>
          </div>
        </div>
      )}

      {showEmailModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 px-4 pb-8">
          <div className="w-full max-w-sm rounded-2xl border border-emerald-300/40 bg-black px-5 py-6 shadow-2xl">
            <Text className="text-center text-lg font-black text-emerald-300">Subscribe + Enter Giveaway</Text>
            <Text className="mt-2 text-center text-sm text-emerald-50/75">Email needed to contact winners.</Text>
            <input
              type="email"
              value={emailValue}
              onChange={(event) => setEmailValue(event.target.value)}
              placeholder="you@example.com"
              className="mt-5 w-full rounded-xl border border-emerald-300/30 bg-black px-3 py-3 text-sm text-emerald-50 outline-none"
            />
            {emailMessage && <Text className="mt-3 text-xs text-yellow-200">{emailMessage}</Text>}
            <button
              type="button"
              onClick={() => submitEmail().catch(() => {})}
              disabled={emailSubmitting}
              className="mt-5 w-full rounded-xl bg-emerald-300 py-3 font-black text-black disabled:bg-gray-600 disabled:text-white"
            >
              {emailSubmitting ? "Subscribing..." : "I want to WIN!"}
            </button>
            <button
              type="button"
              onClick={() => setShowEmailModal(false)}
              className="mt-3 w-full rounded-xl py-2 text-sm text-emerald-50/60"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {actionError && (
        <div className="fixed inset-x-0 bottom-4 z-50 mx-auto w-full max-w-sm px-4">
          <button
            type="button"
            onClick={() => setActionError("")}
            className="w-full rounded-2xl border border-red-400/40 bg-red-950/95 px-4 py-3 text-left"
          >
            <Text className="text-sm text-red-100">{actionError}</Text>
          </button>
        </div>
      )}
    </MiniAppShell>
  );
}

function Disclaimer() {
  return (
    <section className="px-4 py-7">
      <div className="mx-auto max-w-md rounded-2xl border border-emerald-300/25 bg-black/60 p-4">
        <Text className="text-xs leading-relaxed text-emerald-50/65">
          * Current Prize Pool and Current Airdrop refers to the value if the $1M Warplet was sold right now for {STATIC_DISCLAIMER_PRICE}. As the dutch auction price drops so to does the prizes. But, you never know when someone will buy!
        </Text>
        <Text className="mt-3 text-xs leading-relaxed text-emerald-50/65">
          ** Airdrop estimates are based on the current floor price. Depending on available market supply and depth, for large purchases the price may increase significantly. This would reduce the estimated quanity that can be purchased and airdropped.
        </Text>
      </div>
    </section>
  );
}

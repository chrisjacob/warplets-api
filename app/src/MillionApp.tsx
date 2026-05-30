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

type WatchersResponse = {
  watchers?: unknown;
};

type GrantApplication = {
  id: number;
  status: string;
  fullName: string;
  email: string;
  buildAnswer: string;
  xPostUrl: string | null;
  farcasterPostUrl: string | null;
  emailVerified: boolean;
};

type GrantStatus = {
  grantMonth: string;
  application: GrantApplication | null;
  applicants: EntryAvatar[];
  actionSessionToken: string | null;
  recaptchaSiteKey: string;
  config: {
    xQuoteUrl: string;
    farcasterQuoteUrl: string;
  };
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

const grantSchedule = [
  { day: "1", sale: "$1,000,000", grants: "$500,000 x 1" },
  { day: "2", sale: "$1,000,000", grants: "$50,000 x 10" },
  { day: "3", sale: "$900,000", grants: "$10,000 x 45" },
  { day: "4", sale: "$800,000", grants: "$10,000 x 40" },
  { day: "5", sale: "$700,000", grants: "$10,000 x 35" },
  { day: "6", sale: "$600,000", grants: "$10,000 x 30" },
  { day: "7", sale: "$500,000", grants: "$10,000 x 25" },
  { day: "8", sale: "$400,000", grants: "$10,000 x 20" },
  { day: "9", sale: "$300,000", grants: "$10,000 x 15" },
  { day: "10", sale: "$200,000", grants: "$10,000 x 10" },
  { day: "11", sale: "$100,000", grants: "$50,000 x 1" },
  { day: "12", sale: "$90,000", grants: "$1,000 x 45" },
  { day: "13", sale: "$80,000", grants: "$1,000 x 40" },
  { day: "14", sale: "$70,000", grants: "$1,000 x 35" },
  { day: "15", sale: "$60,000", grants: "$1,000 x 30" },
  { day: "16", sale: "$50,000", grants: "$1,000 x 25" },
  { day: "17", sale: "$40,000", grants: "$1,000 x 20" },
  { day: "18", sale: "$30,000", grants: "$1,000 x 15" },
  { day: "19", sale: "$20,000", grants: "$1,000 x 10" },
  { day: "20", sale: "$10,000", grants: "$5,000 x 1" },
  { day: "21", sale: "$10,000 - $9,000", grants: "$100 x 50-45" },
  { day: "22", sale: "$9,000 - $8,000", grants: "$100 x 45-40" },
  { day: "23", sale: "$8,000 - $7,000", grants: "$100 x 40-35" },
  { day: "24", sale: "$7,000 - $6,000", grants: "$100 x 35-30" },
  { day: "25", sale: "$6,000 - $5,000", grants: "$100 x 30-25" },
  { day: "26", sale: "$5,000 - $4,000", grants: "$100 x 25-20" },
  { day: "27", sale: "$4,000 - $3,000", grants: "$100 x 20-15" },
  { day: "28", sale: "$3,000 - $2,000", grants: "$100 x 15-10" },
  { day: "29", sale: "$2,000 - $1,000", grants: "$100 x 10-5" },
  { day: "30", sale: "$1,000 - $100", grants: "$10 x 50-5" },
];

const FARCASTER_JOIN_URL = "https://farcaster.xyz/~/code/RUZLHN";
const STATIC_DISCLAIMER_PRICE = "$ABC";
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

type PriceDrop = {
  at: number;
  price: number;
};

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

function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US")}`;
}

function getMonthlyAuctionStart(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0);
}

function buildPriceDropSchedule(cycleStart: number): PriceDrop[] {
  const drops: PriceDrop[] = [];

  for (let day = 3; day <= 11; day += 1) {
    drops.push({
      at: cycleStart + (day - 1) * DAY_MS,
      price: 1_000_000 - (day - 2) * 100_000,
    });
  }

  for (let day = 12; day <= 20; day += 1) {
    drops.push({
      at: cycleStart + (day - 1) * DAY_MS,
      price: (21 - day) * 10_000,
    });
  }

  for (let day = 22; day <= 30; day += 1) {
    drops.push({
      at: cycleStart + (day - 1) * DAY_MS,
      price: (31 - day) * 1_000,
    });
  }

  for (let day = 21; day <= 30; day += 1) {
    const dayStart = cycleStart + (day - 1) * DAY_MS;
    const dayStartPrice = (31 - day) * 1_000;
    const maxIntervals = day === 30 ? 90 : 95;
    for (let interval = 1; interval <= maxIntervals; interval += 1) {
      drops.push({
        at: dayStart + interval * 15 * MINUTE_MS,
        price: Math.max(100, dayStartPrice - interval * 10),
      });
    }
  }

  return drops.sort((a, b) => a.at - b.at);
}

function getNextPriceDrop(now: Date): PriceDrop {
  const nowMs = now.getTime();
  const cycleStart = getMonthlyAuctionStart(now);
  const currentCycleDrop = buildPriceDropSchedule(cycleStart).find((drop) => drop.at > nowMs);
  if (currentCycleDrop) return currentCycleDrop;

  const nextCycleStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0);
  return buildPriceDropSchedule(nextCycleStart)[0];
}

function buildRareUrgency(now: Date): string {
  const nextDrop = getNextPriceDrop(now);
  const totalMinutes = Math.max(0, Math.ceil((nextDrop.at - now.getTime()) / MINUTE_MS));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hourLabel = hours === 1 ? "Hour" : "Hours";
  const minuteLabel = minutes === 1 ? "Minute" : "Minutes";
  const duration = hours > 0
    ? `${hours} ${hourLabel} ${minutes} ${minuteLabel}`
    : `${minutes} ${minuteLabel}`;

  return `⚠️ Price drops to ${formatUsd(nextDrop.price)} in ${duration}.`;
}

function buildPromoCards(rareUrgency: string): PromoCard[] {
  return [
    {
      id: "rare",
      title: "Attention for Projects\nFunding for Builders\nAirdrops for NFTs\n$1M Warplet",
      subtitle: "30 Day Auction: $1,000,000 → $100",
      imageUrl: "https://millions.10x.meme/WPLTX1_1000x1000.jpg",
      urgency: rareUrgency,
      ctas: [
        {
          label: "About $1M Warplet + 12 Months of Attention",
          kind: "external",
          href: "https://link.10x.meme/1mwarplet",
        },
      ],
    },
    {
      id: "builders",
      title: "10X Builders",
      subtitle: "50% of Sale = Free Grants: $500,000 → $10",
      imageUrl: "https://warplets.10x.meme/1.jpg",
      urgency: "🤝 Zero Equity. No Strings Attached. Free Money.",
      ctas: [
        {
          label: "Apply Now (Fund Your BIG Idea!)",
          kind: "enter",
        },
      ],
    },
    {
      id: "airdrop",
      title: "10X Warplets\n💚\nThe Warplets",
      subtitle: "20% of Sale = Buy & Airdrop NFTs.",
      imageUrl: "https://warplets.10x.meme/2.jpg",
      urgency: "🎁 Current Airdrop**: $10,000 = 500 10X Warplets\n+ $10,000 = 5000 The Warplets.",
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
    <div className="mt-4 flex items-center justify-center gap-2">
      <Text className="text-sm font-semibold whitespace-nowrap" style={{ color: "#b7ffb7" }}>{label}</Text>
      <div className="flex flex-nowrap overflow-x-auto pb-1">
        {avatars.slice(0, 10).map((avatar) => (
          <button
            key={`${avatar.fid}-${avatar.pfpUrl}`}
            type="button"
            className="h-8 w-8 min-h-8 min-w-8 shrink-0 overflow-hidden rounded-full bg-black -ml-2 first:ml-0"
            style={{ border: "2px solid #00FF00" }}
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

function GrantScheduleTable() {
  return (
    <div className="rounded-2xl overflow-hidden border border-[#00FF00]/35 bg-[#041204]/85 p-0">
      <table className="w-full table-fixed border-separate border-spacing-0 text-left">
        <thead>
          <tr>
            <th className="w-[17%] border-b border-r border-[#00FF00]/25 px-2 py-2 text-xs text-center" style={{ color: "#00FF00" }}>Day</th>
            <th className="w-[40%] border-b border-r border-[#00FF00]/25 px-2 py-2 text-xs text-center" style={{ color: "#00FF00" }}>Sale</th>
            <th className="w-[43%] border-b border-[#00FF00]/25 px-2 py-2 text-xs text-center" style={{ color: "#00FF00" }}>Grants</th>
          </tr>
        </thead>
        <tbody>
          {grantSchedule.map((row) => (
            <tr key={row.day}>
              <td className="border-b border-r border-[#00FF00]/20 px-2 py-2 text-xs font-semibold text-center" style={{ color: "#b7ffb7" }}>{row.day}</td>
              <td className="border-b border-r border-[#00FF00]/20 px-2 py-2 text-xs text-center" style={{ color: "#b7ffb7" }}>{row.sale}</td>
              <td className="border-b border-[#00FF00]/20 px-2 py-2 text-xs font-semibold text-center" style={{ color: "#b7ffb7" }}>{row.grants}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PromoSection({
  card,
  referralMillionUrl,
  entryAvatars,
  onEnter,
  watchers,
  applicants,
  onRareCtaClick,
}: {
  card: PromoCard;
  referralMillionUrl: string;
  entryAvatars: EntryAvatar[];
  onEnter: () => void;
  watchers?: EntryAvatar[];
  applicants?: EntryAvatar[];
  onRareCtaClick?: () => Promise<void>;
}) {
  const runCta = async (cta: PromoCard["ctas"][number]) => {
    await hapticPrimaryTap();
    if (cta.kind === "external" && cta.href) {
      if (card.id === "rare" && onRareCtaClick) {
        await onRareCtaClick().catch(() => {});
      }
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

  const renderTitle = () => {
    if (card.id !== "rare") {
      return (
        <Text className="text-[clamp(1.6rem,5vw,1.6rem)] font-bold leading-tight text-center whitespace-pre-line" style={{ color: "#00FF00" }}>
          {card.title}
        </Text>
      );
    }

    const [attention, funding, airdrops, warplet] = card.title.split("\n");
    return (
      <div className="text-center text-[#0F0]" style={{ color: "#0F0" }}>
        <Text className="text-[2.45rem] font-bold leading-[1.5] text-[#0F0]" style={{ color: "#0F0" }}>{attention}</Text>
        <Text className="text-[2.25rem] font-bold leading-[1.5] text-[#0F0]" style={{ color: "#0F0" }}>{funding}</Text>
        <Text className="text-[2.05rem] font-bold leading-[1.5] text-[#0F0]" style={{ color: "#0F0" }}>{airdrops}</Text>
        <Text className="mt-3 text-[clamp(1.6rem,5vw,1.6rem)] font-bold leading-tight text-[#0F0]" style={{ color: "#0F0" }}>{warplet}</Text>
      </div>
    );
  };

  return (
    <section className="space-y-3 pb-4">
      {renderTitle()}
      <Text className="text-lg font-semibold leading-snug text-center" style={{ color: "#00FF00" }}>{card.subtitle}</Text>
      <div className="w-full rounded-[20px] p-[2px] bg-[#00FF00]/20 border border-[#00FF00]/45">
        <img src={card.imageUrl} alt={card.title} className="aspect-square w-full rounded-[18px] object-cover" />
      </div>
      <div className="space-y-3">
        {card.ctas.map((cta) => (
          <button
            key={`${card.id}-${cta.label}`}
            type="button"
            onClick={() => runCta(cta).catch(() => {})}
            className="w-full rounded-[20px] border border-[#009900] bg-[#00FF00] px-5 py-3 text-base font-bold shadow-[3px_6px_0_#008000] transition-all duration-100 active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000] cursor-pointer"
            style={{ color: "rgb(0, 80, 0)" }}
          >
            {cta.label}
          </button>
        ))}
      </div>
      <Text className="text-sm font-semibold leading-relaxed text-center whitespace-pre-line" style={{ color: "#b7ffb7" }}>{card.urgency}</Text>
      {card.id === "builders" && applicants && applicants.length > 0 && (
        <AvatarStack avatars={applicants} label="Applicants:" />
      )}
      {card.id === "builders" && <GrantScheduleTable />}
      {card.id === "rare" && watchers && watchers.length > 0 && (
        <AvatarStack avatars={watchers} label="Watchers:" />
      )}
    </section>
  );
}

function StatBox({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl border border-[#0F0]/30 bg-black/60 px-3 py-4 text-center">
      <Text className="text-2xl font-black text-[#0F0]">{value}</Text>
      <Text className="mt-1 text-[11px] font-bold uppercase tracking-wide text-[#0F0]/70">{label}</Text>
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
  const [watchers, setWatchers] = useState<EntryAvatar[]>([]);
  const [grantStatus, setGrantStatus] = useState<GrantStatus | null>(null);
  const [grantFullName, setGrantFullName] = useState("");
  const [grantEmail, setGrantEmail] = useState("");
  const [grantAnswer, setGrantAnswer] = useState("");
  const [grantXPostUrl, setGrantXPostUrl] = useState("");
  const [grantFarcasterPostUrl, setGrantFarcasterPostUrl] = useState("");
  const [grantSubmitting, setGrantSubmitting] = useState(false);
  const [grantMessage, setGrantMessage] = useState("");
  const [auctionClock, setAuctionClock] = useState(() => new Date());
  const { isMenuRoute, canGoBack, actions } = useMiniAppChrome("million");

  const rareUrgency = useMemo(() => buildRareUrgency(auctionClock), [auctionClock]);
  const promoCards = useMemo(() => buildPromoCards(rareUrgency), [rareUrgency]);
  const referralMillionUrl = useMemo(() => buildMillionUrl(fid), [fid]);
  const searchParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const forceEntryAvatars = searchParams.get("entries") === "1";
  const referrerFid = searchParams.get("fid");

  const enterPath = `${getMillionRootPath().replace(/\/$/, "")}/enter`.replace(/^\/enter$/, "/enter");
  const goToEnter = () => {
    window.history.pushState(window.history.state, "", enterPath);
    setRouteMode("enter");
  };

  useEffect(() => {
    const interval = window.setInterval(() => setAuctionClock(new Date()), MINUTE_MS);
    return () => window.clearInterval(interval);
  }, []);

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

  const normalizeWatchers = (raw: unknown): EntryAvatar[] => {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const row = item as { fid?: unknown; username?: unknown; pfpUrl?: unknown };
        if (typeof row.fid !== "number" || !Number.isFinite(row.fid)) return null;
        if (typeof row.pfpUrl !== "string" || row.pfpUrl.trim().length === 0) return null;
        return {
          fid: row.fid,
          username: typeof row.username === "string" && row.username.trim().length > 0 ? row.username : String(row.fid),
          pfpUrl: row.pfpUrl,
        } satisfies EntryAvatar;
      })
      .filter((item): item is EntryAvatar => item !== null)
      .slice(0, 10);
  };

  const loadWatchers = async (viewerFid: number | null, token: string | null) => {
    try {
      const params = new URLSearchParams();
      if (viewerFid) params.set("fid", String(viewerFid));
      if (token) params.set("sessionToken", token);
      const query = params.toString();
      const response = await fetch(`/api/million-watchers${query ? `?${query}` : ""}`);
      if (!response.ok) return;
      const data = (await response.json()) as WatchersResponse;
      setWatchers(normalizeWatchers(data.watchers));
    } catch {
      setWatchers([]);
    }
  };

  const loadGrantStatus = async (viewerFid: number | null, token: string | null) => {
    try {
      const params = new URLSearchParams();
      if (viewerFid) params.set("fid", String(viewerFid));
      if (token) params.set("sessionToken", token);
      const query = params.toString();
      const response = await fetch(`/api/million-grants/status${query ? `?${query}` : ""}`);
      if (!response.ok) return null;
      const data = (await response.json()) as GrantStatus;
      setGrantStatus(data);
      if (data.actionSessionToken) setActionSessionToken(data.actionSessionToken);
      if (data.application) {
        setGrantFullName(data.application.fullName);
        setGrantEmail(data.application.email);
        setGrantAnswer(data.application.buildAnswer);
        setGrantXPostUrl(data.application.xPostUrl ?? "");
        setGrantFarcasterPostUrl(data.application.farcasterPostUrl ?? "");
      } else if (!grantEmail && status?.email) {
        setGrantEmail(status.email);
      }
      return data;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    let shouldCallReady = false;

    const init = async () => {
      try {
        const inMiniApp =
          typeof sdk.isInMiniApp === "function" ? await sdk.isInMiniApp() : true;
        if (!inMiniApp) {
          setShowOpenInFarcaster(true);
          const data = await loadMillionStatus(null, null);
          if (data.email && !grantEmail) setGrantEmail(data.email);
          await loadWatchers(null, null);
          await loadGrantStatus(null, null);
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
        if (data.email && !grantEmail) setGrantEmail(data.email);
        await loadWatchers(viewerFid, token);
        await loadGrantStatus(viewerFid, token);
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

  useEffect(() => {
    const siteKey = grantStatus?.recaptchaSiteKey?.trim();
    if (!siteKey || document.querySelector("script[data-million-recaptcha='1']")) return;
    const script = document.createElement("script");
    script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
    script.async = true;
    script.defer = true;
    script.dataset.millionRecaptcha = "1";
    document.head.appendChild(script);
  }, [grantStatus?.recaptchaSiteKey]);

  const refreshStatus = async () => {
    if (!fid) return;
    await loadMillionStatus(fid, actionSessionToken || null);
  };

  const trackRareWatcher = async () => {
    if (!fid) return;
    try {
      const response = await fetch("/api/million-watchers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fid,
          sessionToken: actionSessionToken || undefined,
        }),
      });
      if (!response.ok) return;
      const data = (await response.json()) as WatchersResponse;
      setWatchers(normalizeWatchers(data.watchers));
    } catch {
      return;
    }
  };

  const grantAnswerWordCount = grantAnswer.trim().split(/\s+/).filter(Boolean).length;
  const attentionUnlocked = Boolean(
    grantStatus?.application?.emailVerified && grantStatus.application.status === "accepted"
  );
  const grantShareTextX = `What am I building?\n\n${grantAnswer.trim()}\n\n@10XMemeX`;
  const grantShareTextFarcaster = `What am I building?\n\n${grantAnswer.trim()}\n\n@10XMeme.eth`;

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text).catch(() => {});
  };

  const executeRecaptcha = async (): Promise<string | null> => {
    const siteKey = grantStatus?.recaptchaSiteKey?.trim();
    if (!siteKey) return null;
    const grecaptcha = (window as Window & {
      grecaptcha?: {
        ready: (callback: () => void) => void;
        execute: (siteKey: string, options: { action: string }) => Promise<string>;
      };
    }).grecaptcha;
    if (!grecaptcha) return null;
    return new Promise((resolve) => {
      grecaptcha.ready(() => {
        grecaptcha.execute(siteKey, { action: "million_grant_apply" }).then(resolve).catch(() => resolve(null));
      });
    });
  };

  const refreshGrantStatus = async () => {
    await loadGrantStatus(fid, actionSessionToken || null);
  };

  const submitGrantApplication = async () => {
    if (grantSubmitting) return;
    setGrantMessage("");
    if (!grantFullName.trim()) {
      setGrantMessage("Please enter your full name.");
      return;
    }
    if (!grantEmail.trim()) {
      setGrantMessage("Please enter your email.");
      return;
    }
    if (!grantAnswer.trim() || grantAnswerWordCount > 10) {
      setGrantMessage("Answer must be 10 words or less.");
      return;
    }

    setGrantSubmitting(true);
    try {
      const subscribeResponse = await fetch("/api/email/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: grantEmail.trim(),
          fid: fid ?? undefined,
          username,
          campaign: "million-grant",
          sessionToken: actionSessionToken || undefined,
        }),
      });
      if (!subscribeResponse.ok) throw new Error(await subscribeResponse.text());
      const subscribePayload = (await subscribeResponse.json()) as { alreadyVerified?: boolean; verificationEmailSent?: boolean };
      if (!subscribePayload.alreadyVerified) {
        setGrantMessage(subscribePayload.verificationEmailSent
          ? "Verification sent. Please verify your email, then return and submit again."
          : "Please verify your email, then return and submit again.");
        await refreshGrantStatus();
        return;
      }

      const recaptchaToken = await executeRecaptcha();
      const applyResponse = await fetch("/api/million-grants/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fid: fid ?? undefined,
          sessionToken: actionSessionToken || undefined,
          fullName: grantFullName.trim(),
          email: grantEmail.trim(),
          buildAnswer: grantAnswer.trim(),
          xPostUrl: grantXPostUrl.trim() || undefined,
          farcasterPostUrl: grantFarcasterPostUrl.trim() || undefined,
          recaptchaToken: recaptchaToken || undefined,
        }),
      });
      const applyPayload = await applyResponse.json().catch(() => null) as { error?: string; status?: string } | null;
      if (!applyResponse.ok) throw new Error(applyPayload?.error ?? "Unable to submit application.");
      await refreshGrantStatus();
      await refreshStatus();
      setGrantMessage(applyPayload?.status === "pending_review"
        ? "Application received and pending review."
        : "Application received. 10X Attention is unlocked.");
      await hapticSuccess();
    } catch (err) {
      void hapticError();
      setGrantMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setGrantSubmitting(false);
    }
  };

  const openGrantShareX = async () => {
    await copyToClipboard(grantShareTextX);
    const params = new URLSearchParams({ text: grantShareTextX });
    const quoteUrl = grantStatus?.config.xQuoteUrl?.trim();
    if (quoteUrl) params.set("url", quoteUrl);
    await sdk.actions.openUrl(`https://x.com/intent/post?${params.toString()}`).catch(() => {});
  };

  const openGrantShareFarcaster = async () => {
    await copyToClipboard(grantShareTextFarcaster);
    const quoteUrl = grantStatus?.config.farcasterQuoteUrl?.trim();
    if (fid) {
      await sdk.actions.composeCast({
        text: grantShareTextFarcaster,
        embeds: quoteUrl ? [quoteUrl] : undefined,
        channelKey: "10xmeme",
      } as Parameters<typeof sdk.actions.composeCast>[0] & { channelKey: string }).catch(() => {});
      return;
    }
    await sdk.actions.openUrl(FARCASTER_JOIN_URL).catch(() => {});
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
    <div className="relative z-10 w-full max-w-md mx-auto text-center space-y-4 px-4 pt-2 pb-8">
      <div className="space-y-5">
        {promoCards.map((card) => (
          <PromoSection
            key={card.id}
            card={card}
            referralMillionUrl={referralMillionUrl}
            entryAvatars={status?.entryAvatars ?? []}
            onEnter={goToEnter}
            watchers={watchers}
            applicants={grantStatus?.applicants ?? []}
            onRareCtaClick={trackRareWatcher}
          />
        ))}
      </div>
      <Disclaimer />
    </div>
  );

  const renderEntryPage = () => {
    const actionsList = status?.actions ?? [];
    return (
      <>
        <section className="px-4 py-7">
          <div className="mx-auto max-w-md space-y-7">
            <div className="rounded-2xl border border-[#0F0]/25 bg-black/60 p-4">
              <Text className="text-center text-3xl font-black text-[#0F0]">10X Builders</Text>
              <Text className="mt-2 text-center text-sm font-bold text-[#0F0]/80">Grant Application</Text>
              <div className="mt-5 grid grid-cols-1 gap-3">
                <input value={grantFullName} onChange={(event) => setGrantFullName(event.target.value)} className="w-full rounded-xl border border-[#0F0]/25 bg-black px-3 py-3 text-sm text-[#0F0] outline-none" placeholder="Full name" />
                <input type="email" value={grantEmail} onChange={(event) => setGrantEmail(event.target.value)} className="w-full rounded-xl border border-[#0F0]/25 bg-black px-3 py-3 text-sm text-[#0F0] outline-none" placeholder="Email" />
                <textarea value={grantAnswer} onChange={(event) => setGrantAnswer(event.target.value)} className="min-h-24 w-full rounded-xl border border-[#0F0]/25 bg-black px-3 py-3 text-sm text-[#0F0] outline-none" placeholder="What are you building? (10 words or less)" />
                <Text className={grantAnswerWordCount > 10 ? "text-left text-xs text-red-300" : "text-left text-xs text-[#0F0]/55"}>{grantAnswerWordCount}/10 words</Text>
              </div>
              <div className="mt-4 rounded-xl border border-[#0F0]/20 bg-[#041204]/65 p-3 text-left">
                <Text className="text-sm font-black text-[#0F0]">Optional public context</Text>
                <Text className="mt-1 text-xs leading-relaxed text-[#0F0]/65">Share your answer publicly if you want judges to see more context. You can elaborate, make a thread, and add images or video.</Text>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => openGrantShareX().catch(() => {})} disabled={!grantAnswer.trim()} className="rounded-xl bg-[#0F0] px-3 py-2 text-xs font-black text-black disabled:bg-gray-700 disabled:text-gray-300">Draft on X</button>
                  <button type="button" onClick={() => openGrantShareFarcaster().catch(() => {})} disabled={!grantAnswer.trim()} className="rounded-xl bg-[#0F0] px-3 py-2 text-xs font-black text-black disabled:bg-gray-700 disabled:text-gray-300">Draft on Farcaster</button>
                </div>
                {!fid && <Text className="mt-3 text-xs leading-relaxed text-[#0F0]/60">Farcaster: 1. Join Farcaster at {FARCASTER_JOIN_URL} 2. Copy the drafted text, post it, then paste the cast URL below.</Text>}
                <input value={grantXPostUrl} onChange={(event) => setGrantXPostUrl(event.target.value)} className="mt-3 w-full rounded-xl border border-[#0F0]/25 bg-black px-3 py-2 text-xs text-[#0F0] outline-none" placeholder="Optional X post URL" />
                <input value={grantFarcasterPostUrl} onChange={(event) => setGrantFarcasterPostUrl(event.target.value)} className="mt-2 w-full rounded-xl border border-[#0F0]/25 bg-black px-3 py-2 text-xs text-[#0F0] outline-none" placeholder="Optional Farcaster cast URL" />
              </div>
              {grantStatus?.application && (
                <Text className="mt-4 text-sm font-bold text-[#0F0]">
                  Application status: {grantStatus.application.status === "accepted" ? "Accepted" : "Pending review"}
                  {grantStatus.application.emailVerified ? " + verified email" : " + email pending verification"}
                </Text>
              )}
              {grantMessage && <Text className="mt-4 text-sm text-yellow-200">{grantMessage}</Text>}
              <button type="button" onClick={() => submitGrantApplication().catch(() => {})} disabled={grantSubmitting} className="mt-5 w-full rounded-xl bg-[#0F0] py-3 font-black text-black disabled:bg-gray-600 disabled:text-white">
                {grantSubmitting ? "Submitting..." : "Submit Grant Application"}
              </button>
            </div>
            <Text className="text-center text-3xl font-black text-[#0F0]">10X Attention</Text>
            <Text className="mt-2 text-center text-sm font-bold text-[#0F0]/80">Optional giveaway actions for more points</Text>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <StatBox value={status?.userEntries ?? 0} label="Your Points" />
              <StatBox value={status?.totalEntries ?? 0} label="Total Points" />
              <StatBox value={status?.daysLeft ?? 0} label="Days Left" />
            </div>
            {!attentionUnlocked && (
              <Text className="mt-3 rounded-xl border border-yellow-300/25 bg-yellow-950/30 px-3 py-3 text-center text-xs font-bold text-yellow-100">
                Submit an accepted 10X Builders Grant application with a verified email to unlock 10X Attention.
              </Text>
            )}
            <div className="mt-5 space-y-3">
              {actionsList.map((action) => {
                const pending = pendingVerify[action.slug] === true;
                const showVerify =
                  pending ||
                  (Boolean(action.previouslyCompleted) && rejectedVerify[action.slug] !== true) ||
                  (action.slug === "million-enter-email" && Boolean(status?.email) && !action.completed);
                return (
                  <div key={action.slug} className="rounded-xl border border-[#0F0]/25 bg-black/65 p-3">
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <Text className="text-sm font-black text-[#0F0]">{action.name}</Text>
                        <Text className="mt-1 text-xs text-[#0F0]/60">{action.description}</Text>
                      </div>
                      <button
                        type="button"
                        disabled={pending || !attentionUnlocked}
                        onClick={() => {
                          if (showVerify) {
                            verifyAction(action.slug).catch(() => {});
                          } else {
                            runAction(action).catch(() => {});
                          }
                        }}
                        className="flex h-11 min-w-14 items-center justify-center rounded-xl bg-[#0F0] px-3 text-sm font-black text-black disabled:bg-gray-600 disabled:text-white"
                      >
                        {action.completed ? <ActionCheckIcon /> : pending ? "..." : showVerify ? "Verify" : `+${action.entryValue}`}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 rounded-2xl border border-[#0F0]/25 bg-black/60 p-4">
              <Text className="text-lg font-black text-[#0F0]">Earn Referral Points</Text>
              <Text className="mt-2 text-sm text-[#0F0]/75">
                Share your $1M Warplet referral link. Every referral earns 1 bonus point, up to 10 bonus points.
              </Text>
              <input
                readOnly
                value={referralMillionUrl}
                className="mt-3 w-full rounded-xl border border-[#0F0]/25 bg-black px-3 py-2 text-xs text-[#0F0]"
              />
              <Text className="mt-2 text-xs font-bold text-[#0F0]">
                Your referrals: {status?.referralCount ?? 0} • Bonus points: {status?.referralBonusEntries ?? 0}/10
              </Text>
            </div>

            <div className="mt-6 rounded-2xl border border-[#0F0]/25 bg-black/60 p-4">
              <Text className="text-lg font-black text-[#0F0]">Top Referrers</Text>
              <div className="mt-3 space-y-2">
                {(status?.topReferrers ?? []).slice(0, 10).map((referrer, index) => (
                  <button
                    key={referrer.fid}
                    type="button"
                    onClick={() => sdk.actions.viewProfile({ fid: referrer.fid }).catch(() => {})}
                    className="flex w-full items-center gap-3 rounded-xl bg-[#041204]/80 px-3 py-2 text-left"
                  >
                    <Text className="w-6 text-sm font-black text-[#0F0]">#{index + 1}</Text>
                    {referrer.pfpUrl && <img src={referrer.pfpUrl} alt={referrer.username} className="h-8 w-8 rounded-full object-cover" />}
                    <Text className="flex-1 text-sm font-bold text-[#0F0]">{referrer.username}</Text>
                    <Text className="text-sm font-black text-[#0F0]">{referrer.referrals}</Text>
                  </button>
                ))}
                {(status?.topReferrers ?? []).length === 0 && (
                  <Text className="text-sm text-[#0F0]/60">No referrals yet.</Text>
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
          <div className="mx-auto max-w-md rounded-2xl border border-[#0F0]/25 bg-black/60 p-4">
            <Text className="text-lg font-black text-[#0F0]">Terms and Conditions</Text>
            <Text className="mt-2 text-xs leading-relaxed text-[#0F0]/65">
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
          title={routeMode === "enter" ? "Builders + Attention" : getHeaderTitle("million", isMenuRoute)}
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
            <Text className="text-sm font-bold text-[#0F0]">Loading $1M Warplet...</Text>
          </div>
        ) : routeMode === "enter" ? renderEntryPage() : renderLanding()}
      </div>

      {showAddAppPrompt && !showOpenInFarcaster && (
        <div className="fixed inset-0 z-40 flex items-center justify-center px-4 bg-black/70 backdrop-blur-[2px]">
          <div className="w-full max-w-sm rounded-2xl border border-[#00FF00]/45 bg-[#041204] p-5 shadow-[0_0_40px_rgba(0,255,0,0.15)]">
            <Text className="text-xl font-bold text-left" style={{ color: "#00FF00" }}>
              🟢 Don&apos;t miss out
            </Text>
            <Text className="mt-3 text-sm text-left" style={{ color: "#b7ffb7" }}>
              {notificationsOnlyPrompt
                ? "Please turn on notifications so you don\u2019t miss out on important updates."
                : "Please Add Mini App and enable notifications so you don\u2019t miss out on important updates."}
            </Text>
            <div className="mt-5 grid grid-cols-1 gap-3">
              <button
                type="button"
                onClick={handleConfirmAddAppPrompt}
                className="w-full px-4 py-3 rounded-[14px] border border-[#009900] bg-[#00FF00] hover:bg-[#33ff33] font-bold transition-colors cursor-pointer"
                style={{ color: "rgb(0, 80, 0)" }}
              >
                Ok, let&apos;s go!
              </button>
            </div>
          </div>
        </div>
      )}

      {showEmailModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 px-4 pb-8">
          <div className="w-full max-w-sm rounded-2xl border border-[#0F0]/40 bg-black px-5 py-6 shadow-2xl">
            <Text className="text-center text-lg font-black text-[#0F0]">Subscribe + Enter Giveaway</Text>
            <Text className="mt-2 text-center text-sm text-[#0F0]/75">Email needed to contact winners.</Text>
            <input
              type="email"
              value={emailValue}
              onChange={(event) => setEmailValue(event.target.value)}
              placeholder="you@example.com"
              className="mt-5 w-full rounded-xl border border-[#0F0]/30 bg-black px-3 py-3 text-sm text-[#0F0] outline-none"
            />
            {emailMessage && <Text className="mt-3 text-xs text-yellow-200">{emailMessage}</Text>}
            <button
              type="button"
              onClick={() => submitEmail().catch(() => {})}
              disabled={emailSubmitting}
              className="mt-5 w-full rounded-xl bg-[#0F0] py-3 font-black text-black disabled:bg-gray-600 disabled:text-white"
            >
              {emailSubmitting ? "Subscribing..." : "I want to WIN!"}
            </button>
            <button
              type="button"
              onClick={() => setShowEmailModal(false)}
              className="mt-3 w-full rounded-xl py-2 text-sm text-[#0F0]/60"
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
    <section className="space-y-3">
      <Text className="text-lg font-bold text-left" style={{ color: "#00FF00" }}>
        Terms and Conditions
      </Text>
      <div className="rounded-2xl border border-[#00FF00]/35 bg-[#041204]/85 px-4 py-4 space-y-3">
        <Text className="text-xs leading-relaxed text-left" style={{ color: "#b7ffb7" }}>
          * Current Prize Pool and Current Airdrop refers to the value if the $1M Warplet was sold right now for {STATIC_DISCLAIMER_PRICE}. As the dutch auction price drops so to does the prizes. But, you never know when someone will buy!
        </Text>
        <Text className="text-xs leading-relaxed text-left" style={{ color: "#b7ffb7" }}>
          ** Airdrop estimates are based on the current floor price. Depending on available market supply and depth, for large purchases the price may increase significantly. This would reduce the estimated quanity that can be purchased and airdropped.
        </Text>
      </div>
    </section>
  );
}

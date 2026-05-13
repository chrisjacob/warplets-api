import { useEffect, useState } from "react";
import sdk from "@farcaster/miniapp-sdk";
import { Text } from "@neynar/ui/typography";
import MiniAppShell from "./MiniAppShell";
import {
  MiniAppHeader,
  MiniAppMenuPage,
  getHeaderTitle,
  useMiniAppChrome,
} from "./miniAppChrome.tsx";

const FARCASTER_MINI_APP_URL = "https://farcaster.xyz/miniapps/uR3Rzs-k6AnV/10x";
const CRYING_WARPLET_URL = "https://warplets.10x.meme/3081.png";

type UnsubscribeStatus = {
  activeCount: number;
  hasMatchedEmail: boolean;
  requiresEmailLink: boolean;
  matchedEmails: Array<{
    email: string;
    unsubscribed: boolean;
  }>;
  unsubscribedCount?: number;
  unsubscribedEmails?: string[];
};

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Fall through to a generic message.
  }
  return `Request failed with ${response.status}`;
}

export default function UnsubscribeApp() {
  const [inMiniApp, setInMiniApp] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<UnsubscribeStatus | null>(null);
  const [error, setError] = useState("");
  const { isMenuRoute, canGoBack, actions } = useMiniAppChrome("app");

  const loadStatus = async () => {
    setError("");
    const response = await sdk.quickAuth.fetch("/api/email/unsubscribe-self");
    if (!response.ok) throw new Error(await readError(response));
    setStatus((await response.json()) as UnsubscribeStatus);
  };

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        const inside = typeof sdk.isInMiniApp === "function" ? await sdk.isInMiniApp() : true;
        if (cancelled) return;
        setInMiniApp(inside);
        if (!inside) return;
        await sdk.actions.ready();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  const openMiniApp = () => {
    window.location.href = FARCASTER_MINI_APP_URL;
  };

  const checkEmailSettings = async () => {
    setLoading(true);
    try {
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const unsubscribeInApp = async () => {
    setSubmitting(true);
    setError("");
    try {
      const response = await sdk.quickAuth.fetch("/api/email/unsubscribe-self", {
        method: "POST",
      });
      if (!response.ok) throw new Error(await readError(response));
      setStatus((await response.json()) as UnsubscribeStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const activeMatchedEmails = status?.matchedEmails.filter((email) => !email.unsubscribed) ?? [];
  const visibleMatchedEmails = activeMatchedEmails.length > 0 ? activeMatchedEmails : status?.matchedEmails ?? [];
  const justUnsubscribedEmails = status?.unsubscribedEmails?.filter((email) => email.trim().length > 0) ?? [];
  const justUnsubscribedLabel = justUnsubscribedEmails[0]
    ? justUnsubscribedEmails.length > 1
      ? `${justUnsubscribedEmails[0]} + ${justUnsubscribedEmails.length - 1} more`
      : justUnsubscribedEmails[0]
    : "";
  const matchedEmailLabel = visibleMatchedEmails[0]?.email
    ? visibleMatchedEmails.length > 1
      ? `${visibleMatchedEmails[0].email} + ${visibleMatchedEmails.length - 1} more`
      : visibleMatchedEmails[0].email
    : "";

  const content = (
    <div className="mx-auto w-full max-w-md px-4 pt-2 text-center">
      <div className="relative px-4 pt-2 text-center mb-4">
        <Text className="text-[clamp(1.6rem,5vw,1.6rem)] font-bold leading-tight" style={{ color: "#00FF00" }}>
          Email unsubscribe
        </Text>
        <Text className="mt-3 text-lg font-semibold" style={{ color: "#00FF00" }}>
          No hard feelings. Inbox peace matters.
        </Text>
      </div>

      <div className="px-4 pb-5 pt-0">
        <div className="w-full rounded-[20px] p-[2px] bg-[#00FF00]/20 border border-[#00FF00]/45">
          <img
            src={CRYING_WARPLET_URL}
            alt="A crying Warplet"
            className="w-full rounded-[18px] bg-[#8fa2bd] object-cover"
            loading="eager"
          />
        </div>
      </div>

      <div className="px-4">
        {!inMiniApp ? (
          <>
            <button
              type="button"
              onClick={openMiniApp}
              className="w-full mt-0 px-5 py-3 rounded-[20px] border border-[#009900] bg-[#00FF00] hover:bg-[#33ff33] font-bold text-base transition-all duration-100 shadow-[3px_6px_0_#008000] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000] cursor-pointer"
              style={{ color: "rgb(0, 80, 0)", fontWeight: 700 }}
            >
              Open mini app in Farcaster
            </button>
            <Text className="mt-4 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
              Open in Farcaster so we can verify your FID before changing email settings.
            </Text>
          </>
        ) : loading ? (
          <Text className="mt-4 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
            Loading...
          </Text>
        ) : !status ? (
          <>
            <button
              type="button"
              onClick={checkEmailSettings}
              className="w-full mt-0 px-5 py-3 rounded-[20px] border border-[#009900] bg-[#00FF00] hover:bg-[#33ff33] font-bold text-base transition-all duration-100 shadow-[3px_6px_0_#008000] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000] cursor-pointer"
              style={{ color: "rgb(0, 80, 0)", fontWeight: 700 }}
            >
              Check email settings
            </button>
            <Text className="mt-4 pb-8 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
              We will ask Farcaster to verify your FID before changing email settings.
            </Text>
          </>
        ) : status?.requiresEmailLink ? (
          <Text className="mt-4 pb-8 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
            We could not find an email connected to this FID. Please use the personalized unsubscribe link in your 10X email so we know which address to remove.
          </Text>
        ) : justUnsubscribedLabel ? (
          <Text className="mt-4 pb-8 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
            We have unsubscribed {justUnsubscribedLabel} from receiving emails.
          </Text>
        ) : status?.activeCount === 0 ? (
          <Text className="mt-4 pb-8 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
            You are already unsubscribed{matchedEmailLabel ? ` for ${matchedEmailLabel}` : ""}.
          </Text>
        ) : (
          <>
            <button
              type="button"
              disabled={submitting}
              onClick={unsubscribeInApp}
              className="w-full mt-0 px-5 py-3 rounded-[20px] border border-[#009900] bg-[#00FF00] hover:bg-[#33ff33] font-bold text-base transition-all duration-100 shadow-[3px_6px_0_#008000] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000] disabled:bg-gray-700 disabled:border-gray-700 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 cursor-pointer"
              style={{ color: submitting ? "#ffffff" : "rgb(0, 80, 0)", fontWeight: 700 }}
            >
              Unsubscribe from emails
            </button>
            <Text className="mt-4 pb-8 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
              We found {matchedEmailLabel}. Tap once and we will unsubscribe {activeMatchedEmails.length > 1 ? "the connected emails" : "the connected email"}.
            </Text>
          </>
        )}
        {error && (
          <Text className="mt-4 text-center text-xs text-red-300">
            {error}
          </Text>
        )}
      </div>
    </div>
  );

  return (
    <MiniAppShell>
      <div className="relative z-10 w-full">
        <MiniAppHeader
          appSlug="app"
          title={getHeaderTitle("app", isMenuRoute)}
          canGoBack={canGoBack}
          onBack={actions.goBack}
          onLogo={actions.goToCurrentRoot}
          onMenu={actions.openMenu}
        />
        {isMenuRoute ? <MiniAppMenuPage appSlug="app" /> : content}
      </div>
    </MiniAppShell>
  );
}

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
import { isLikelyDesktop, settingsAuthFetch } from "./settingsAuth";

const FARCASTER_MINI_APP_URL = "https://farcaster.xyz/miniapps/uR3Rzs-k6AnV/10x/stop";
const CRYING_WARPLET_URL = "https://warplets.10x.meme/3081.png";

type StopStatus = {
  fid: number;
  optedOut: boolean;
  username: string | null;
  optedOutOn: string | null;
  optedBackInOn: string | null;
  updatedOn: string | null;
};

function browserOpenMiniApp() {
  window.location.href = FARCASTER_MINI_APP_URL;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Fall through to a generic message.
  }
  return `Request failed with ${response.status}`;
}

export default function StopApp() {
  const [inMiniApp, setInMiniApp] = useState(false);
  const [desktopView, setDesktopView] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<StopStatus | null>(null);
  const [error, setError] = useState("");
  const { isMenuRoute, canGoBack, actions } = useMiniAppChrome("app");

  const loadStatus = async () => {
    setError("");
    const response = await settingsAuthFetch("/api/outreach/stop");
    if (!response.ok) throw new Error(await readError(response));
    setStatus((await response.json()) as StopStatus);
  };

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        const inside = typeof sdk.isInMiniApp === "function" ? await sdk.isInMiniApp() : true;
        if (cancelled) return;
        setInMiniApp(inside);
        setDesktopView(isLikelyDesktop());
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

  const updatePreference = async (nextOptedOut: boolean) => {
    setSubmitting(true);
    setError("");
    try {
      const response = await settingsAuthFetch("/api/outreach/stop", {
        method: nextOptedOut ? "POST" : "DELETE",
        headers: nextOptedOut ? { "content-type": "application/json" } : undefined,
        body: nextOptedOut ? JSON.stringify({}) : undefined,
      });
      if (!response.ok) throw new Error(await readError(response));
      setStatus((await response.json()) as StopStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const checkMentionSettings = async () => {
    setLoading(true);
    try {
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const imageBlock = (
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
  );

  const content = (() => {
    if (!inMiniApp) {
      return (
        <div className="mx-auto w-full max-w-md px-4 pt-2 text-center">
          <div className="relative px-4 pt-2 text-center mb-4">
            <Text className="text-[clamp(1.6rem,5vw,1.6rem)] font-bold leading-tight" style={{ color: "#00FF00" }}>
              Stop 10X @mentions
            </Text>
            <Text className="mt-3 text-lg font-semibold" style={{ color: "#00FF00" }}>
              No hard feelings. Inbox peace matters.
            </Text>
          </div>

          {imageBlock}

          <div className="px-4">
            <button
              type="button"
              onClick={browserOpenMiniApp}
              className="w-full mt-0 px-5 py-3 rounded-[20px] border border-[#009900] bg-[#00FF00] hover:bg-[#33ff33] font-bold text-base transition-all duration-100 shadow-[3px_6px_0_#008000] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000] cursor-pointer"
              style={{ color: "rgb(0, 80, 0)", fontWeight: 700 }}
            >
              Open mini app in Farcaster
            </button>
            <Text className="mt-4 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
              Open in Farcaster so we can verify your FID before changing @mention settings.
            </Text>
          </div>
        </div>
      );
    }

    return (
      <div className="mx-auto w-full max-w-md px-4 pt-2 text-center">
        <div className="relative px-4 pt-2 text-center mb-4">
          <Text className="text-[clamp(1.6rem,5vw,1.6rem)] font-bold leading-tight" style={{ color: "#00FF00" }}>
            @Mention settings
          </Text>
          <Text className="mt-3 text-lg font-semibold" style={{ color: "#00FF00" }}>
            Easy opt-out. Easy opt-back-in.
          </Text>
        </div>

        {imageBlock}

        <div className="px-4">
          {loading ? (
            <Text className="mt-5 text-center text-sm" style={{ color: "#9ca3af" }}>
              Checking your preference...
            </Text>
          ) : !status ? (
            <>
              <button
                type="button"
                onClick={checkMentionSettings}
                className="w-full mt-0 px-5 py-3 rounded-[20px] border border-[#009900] bg-[#00FF00] hover:bg-[#33ff33] font-bold text-base transition-all duration-100 shadow-[3px_6px_0_#008000] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000] cursor-pointer"
                style={{ color: "rgb(0, 80, 0)", fontWeight: 700 }}
              >
                Check @mention settings
              </button>
              <Text className="mt-4 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
                {desktopView
                  ? "On desktop, Farcaster may ask you to confirm sign-in from your phone before this loads."
                  : "Tap to verify your FID before changing @mention settings."}
              </Text>
            </>
          ) : status.optedOut ? (
            <>
              <Text className="text-center text-sm font-bold" style={{ color: "#00FF00" }}>
                You are opted out. We will leave you in peace.
              </Text>
              <button
                type="button"
                disabled={submitting}
                onClick={() => updatePreference(false)}
                className="mt-4 w-full px-5 py-3 rounded-[20px] border border-[#009900] bg-[#00FF00] hover:bg-[#33ff33] font-bold text-base transition-all duration-100 shadow-[3px_6px_0_#008000] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000] disabled:bg-gray-700 disabled:border-gray-700 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 cursor-pointer"
                style={{ color: submitting ? "#ffffff" : "rgb(0, 80, 0)", fontWeight: 700 }}
              >
                Opt back in
              </button>
            </>
          ) : (
            <>
              <Text className="text-center text-sm font-bold" style={{ color: "#00FF00" }}>
                You are currently opted in.
              </Text>
              <button
                type="button"
                disabled={submitting}
                onClick={() => updatePreference(true)}
                className="mt-4 w-full px-5 py-3 rounded-[20px] border border-[#009900] bg-[#00FF00] hover:bg-[#33ff33] font-bold text-base transition-all duration-100 shadow-[3px_6px_0_#008000] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000] disabled:bg-gray-700 disabled:border-gray-700 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 cursor-pointer"
                style={{ color: submitting ? "#ffffff" : "rgb(0, 80, 0)", fontWeight: 700 }}
              >
                Stop mentions
              </button>
            </>
          )}

          <Text className="mt-4 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
            Just a little FYI... our @mentions system follows rules to help it avoid feeling spammy: Maximum of 5 usernames, maximum of 1 mention per day, and we try to mention your genuine friends first (via neynar&apos;s best-friend affinity score). We are also monitoring @mention stats and will adjust these rules based on community feedback.
          </Text>
          <Text className="mt-3 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
            Why do we use @mentions at all? Because our account is still small, and social reach is very important (and very hard). Utilising word-of-mouth on the social graph is essential... but we also get that this can feel annoying. That&apos;s why we&apos;ve built this easy opt-out / opt-back-in.
          </Text>
          <Text className="mt-3 pb-8 text-sm leading-relaxed" style={{ color: "#b7ffb7" }}>
            We&apos;re just trying to help more people discover the fun things we&apos;re building ✌️
          </Text>

          {error && (
            <Text className="mt-4 text-center text-xs text-red-300">
              {error}
            </Text>
          )}
        </div>
      </div>
    );
  })();

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

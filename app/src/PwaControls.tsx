import { useEffect, useState } from "react";
import {
  activatePwaUpdate,
  canPromptPwaInstall,
  isEmbeddedWebView,
  isLikelyBaseAppBrowser,
  isStandaloneDisplay,
  promptPwaInstall,
  subscribeToWebPush,
} from "./pwa";
import { connectBaseAccount, useWalletController } from "./walletController";

const DISMISSED_KEY = "10x-pwa-prompt-dismissed";

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function PwaControls({
  onMessage,
}: {
  onMessage: (kind: "success" | "warning" | "error", message: string) => void;
}) {
  const [installAvailable, setInstallAvailable] = useState(canPromptPwaInstall());
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISSED_KEY) === "1");
  const [busy, setBusy] = useState(false);
  const [webPushConfigured, setWebPushConfigured] = useState(false);
  const [basePinned, setBasePinned] = useState<boolean | null>(null);
  const [closedThisSession, setClosedThisSession] = useState(false);
  const [basePromptRequested, setBasePromptRequested] = useState(false);
  const wallet = useWalletController();
  const standalone = isStandaloneDisplay();
  const baseAppBrowser = isLikelyBaseAppBrowser();
  const embedded = isEmbeddedWebView() && !baseAppBrowser;
  const forceAddPrompt = new URLSearchParams(window.location.search).get("add") === "1";
  const browserCanPush = "Notification" in window && "PushManager" in window && Notification.permission === "default";
  const canPush = browserCanPush && webPushConfigured;
  const showIosInstallHelp = isIos() && !standalone && !embedded && !baseAppBrowser;
  const showBasePinPrompt = baseAppBrowser && !standalone && (basePromptRequested || forceAddPrompt || basePinned !== true);

  useEffect(() => {
    const reopenBasePrompt = () => {
      if (!baseAppBrowser) return;
      setBasePromptRequested(true);
      setClosedThisSession(false);
      setDismissed(false);
    };
    window.addEventListener("warplets:open-base-pin-prompt", reopenBasePrompt);
    return () => window.removeEventListener("warplets:open-base-pin-prompt", reopenBasePrompt);
  }, [baseAppBrowser]);

  useEffect(() => {
    if (!baseAppBrowser) return;
    const controller = new AbortController();
    void fetch("/api/notifications/base/status", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) return;
      const payload = await response.json() as { appPinned?: boolean };
      setBasePinned(payload.appPinned === true);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [baseAppBrowser]);

  const confirmBasePin = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/notifications/base/status?refresh=1", {
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      const payload = await response.json().catch(() => ({})) as { appPinned?: boolean; error?: string };
      if (!response.ok) throw new Error(payload.error || "Base could not confirm the app pin.");
      if (!payload.appPinned) {
        setBasePinned(false);
        onMessage("error", "Base reports that 10X Warplets is not pinned yet. Pin it, then try again.");
        return;
      }
      setBasePinned(true);
      setBasePromptRequested(false);
      setClosedThisSession(true);
      localStorage.setItem(DISMISSED_KEY, "1");
      onMessage("success", "10X Warplets is pinned in Base.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Base could not confirm the app pin.";
      onMessage("error", message === "Base notifications are disabled" ? "App has not yet been pinned." : message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const handleInstall = () => setInstallAvailable(canPromptPwaInstall());
    const handleInstalled = () => setInstallAvailable(false);
    const handleUpdate = () => setUpdateAvailable(true);
    window.addEventListener("10x:pwa-install-available", handleInstall);
    window.addEventListener("10x:pwa-installed", handleInstalled);
    window.addEventListener("10x:pwa-update-available", handleUpdate);
    return () => {
      window.removeEventListener("10x:pwa-install-available", handleInstall);
      window.removeEventListener("10x:pwa-installed", handleInstalled);
      window.removeEventListener("10x:pwa-update-available", handleUpdate);
    };
  }, []);

  useEffect(() => {
    if (!browserCanPush) return;
    const controller = new AbortController();
    void fetch("/api/web-push/public-key", {
      headers: { accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response): Promise<{ publicKey?: string } | null> => response.ok
        ? await response.json() as { publicKey?: string }
        : null)
      .then((payload) => setWebPushConfigured(Boolean(payload?.publicKey)))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setWebPushConfigured(false);
      });
    return () => controller.abort();
  }, [browserCanPush]);

  if (updateAvailable) {
    return (
      <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-40 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-xl border border-[#00FF00]/60 bg-black/95 p-3 text-sm text-[#b7ffb7] shadow-2xl">
        <p>A new 10X version is ready.</p>
        <button
          type="button"
          className="mt-2 rounded-lg bg-[#00FF00] px-3 py-2 font-black text-[#003800]"
          onClick={() => void activatePwaUpdate().then(() => window.location.reload())}
        >
          Update now
        </button>
      </div>
    );
  }

  if (closedThisSession || (!basePromptRequested && !forceAddPrompt && dismissed) || embedded || (!showBasePinPrompt && !installAvailable && !showIosInstallHelp && !canPush)) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
    setClosedThisSession(true);
    setBasePromptRequested(false);
  };

  const runPrimaryAction = async () => {
    if (showBasePinPrompt) {
      if (!wallet.session?.address) {
        setBusy(true);
        try {
          await connectBaseAccount();
        } catch (error) {
          onMessage("error", error instanceof Error ? error.message : "Base wallet connection failed.");
          setBusy(false);
          return;
        }
      }
      await confirmBasePin();
      return;
    }
    if (showIosInstallHelp) {
      onMessage("warning", "On iPhone or iPad, tap Share, then Add to Home Screen. Open the installed app to enable Web Push.");
      dismiss();
      return;
    }
    setBusy(true);
    try {
      if (installAvailable) {
        const result = await promptPwaInstall();
        if (result === "accepted") onMessage("success", "10X Warplets was installed.");
        else if (result === "dismissed") onMessage("warning", "Installation was dismissed. You can install later from your browser menu.");
      } else {
        await subscribeToWebPush(["announcements"]);
        onMessage("success", "Web notifications are enabled for general 10X announcements.");
        dismiss();
      }
    } catch (error) {
      onMessage("error", error instanceof Error ? error.message : "The request could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed bottom-0 left-1/2 z-50 w-full max-w-[500px] -translate-x-1/2 px-4">
      <div className="overflow-hidden rounded-t-2xl border border-b-0 border-[#00FF00]/35 bg-black shadow-[0_-12px_28px_rgba(0,0,0,0.75)]">
        <div className="flex items-center justify-between gap-3 border-b border-[#00FF00]/20 bg-black px-4 py-3">
          <p className="min-w-0 text-base font-bold text-[#8bbf8b]">
            {showBasePinPrompt ? (
              <><span className="text-[#00FF00]">Pin App</span> Stay Updated</>
            ) : installAvailable || showIosInstallHelp ? (
              <><span className="text-[#00FF00]">Install App</span> Unlock Faster Access</>
            ) : (
              <><span className="text-[#00FF00]">Enable</span> Web Notifications</>
            )}
          </p>
          <button
            type="button"
            aria-label="Close install prompt"
            title="Close"
            onClick={dismiss}
            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[#00FF00]/35 text-xl leading-none text-[#00FF00] hover:bg-[#041204]"
          >
            ×
          </button>
        </div>
        <div className={showBasePinPrompt ? "px-2 pb-5 pt-4" : "p-4 pb-5"}>
          {showBasePinPrompt ? (
            <>
              <p className="mb-3 px-1 text-left text-xs leading-5 text-[#b7ffb7]">
                Tap the bottom-right <strong className="text-white">…</strong> menu in Base, then choose <strong className="text-[#00FF00]">📌 Pin</strong>.
              </p>
              <div className="mb-4 rounded-xl border border-[#00FF00]/45 bg-[#001000] p-3">
                <img src="/base-pin3.jpg" alt="Open the bottom-right Base menu and choose Pin" className="mx-auto block h-auto w-full max-w-[360px] rounded-lg" />
              </div>
            </>
          ) : null}
          <button
            type="button"
            disabled={busy}
            className="mb-1.5 w-full cursor-pointer rounded-[20px] border border-[#009900] bg-[#00FF00] px-4 py-3 text-sm font-black text-[rgb(0,80,0)] shadow-[3px_6px_0_#008000] transition-all duration-100 hover:bg-[#33ff33] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000] disabled:cursor-wait disabled:opacity-50"
            onClick={() => void runPrimaryAction()}
          >
            {showBasePinPrompt ? (busy ? "Confirming…" : "Yes, I have Pinned the app…") : showIosInstallHelp ? "Install 10X Warplets" : installAvailable ? "Install 10X Warplets" : "Enable web notifications"}
          </button>
        </div>
      </div>
    </div>
  );
}

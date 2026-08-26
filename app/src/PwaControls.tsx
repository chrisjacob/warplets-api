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

const DISMISSED_KEY = "10x-pwa-prompt-dismissed";

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function PwaControls({
  onMessage,
  appName = "10X Warplets",
  autoPrompt = true,
}: {
  onMessage: (kind: "success" | "warning" | "error", message: string) => void;
  appName?: string;
  autoPrompt?: boolean;
}) {
  const [installAvailable, setInstallAvailable] = useState(canPromptPwaInstall());
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISSED_KEY) === "1");
  const [busy, setBusy] = useState(false);
  const [webPushConfigured, setWebPushConfigured] = useState(false);
  const [closedThisSession, setClosedThisSession] = useState(false);
  const [manualInstallRequested, setManualInstallRequested] = useState(false);
  const standalone = isStandaloneDisplay();
  const baseAppBrowser = isLikelyBaseAppBrowser();
  const embedded = isEmbeddedWebView();
  const forceAddPrompt = new URLSearchParams(window.location.search).get("add") === "1";
  const browserCanPush = "Notification" in window && "PushManager" in window && Notification.permission === "default";
  const canPush = browserCanPush && webPushConfigured;
  const showIosInstallHelp = isIos() && !standalone && !embedded && !baseAppBrowser;

  useEffect(() => {
    const openInstallPrompt = () => {
      if (standalone || embedded || baseAppBrowser) return;
      setManualInstallRequested(true);
      setClosedThisSession(false);
    };
    window.addEventListener("10x:open-pwa-install", openInstallPrompt);
    return () => window.removeEventListener("10x:open-pwa-install", openInstallPrompt);
  }, [baseAppBrowser, embedded, standalone]);

  useEffect(() => {
    const handleInstall = () => setInstallAvailable(canPromptPwaInstall());
    const handleInstalled = () => {
      setInstallAvailable(false);
      setManualInstallRequested(false);
    };
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

  if (baseAppBrowser || embedded || (!manualInstallRequested && (
    !autoPrompt ||
    closedThisSession ||
    (!forceAddPrompt && dismissed) ||
    (!installAvailable && !showIosInstallHelp && !canPush)
  ))) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
    setClosedThisSession(true);
    setManualInstallRequested(false);
  };

  const runPrimaryAction = async () => {
    if (manualInstallRequested && !installAvailable) {
      onMessage("warning", showIosInstallHelp
        ? `On iPhone or iPad, tap Share, then Add to Home Screen to install ${appName}.`
        : `Install ${appName} from your browser's Install app menu.`);
      dismiss();
      return;
    }
    if (showIosInstallHelp) {
      onMessage("warning", `On iPhone or iPad, tap Share, then Add to Home Screen. Open the installed ${appName} app to enable Web Push.`);
      dismiss();
      return;
    }
    setBusy(true);
    try {
      if (installAvailable) {
        const result = await promptPwaInstall();
        if (result === "accepted") onMessage("success", `${appName} was installed.`);
        else if (result === "dismissed") onMessage("warning", "Installation was dismissed. You can install later from your browser menu.");
        setManualInstallRequested(false);
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
            {manualInstallRequested || installAvailable || showIosInstallHelp ? (
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
        <div className="p-4 pb-5">
          <button
            type="button"
            disabled={busy}
            className="mb-1.5 w-full cursor-pointer rounded-[20px] border border-[#009900] bg-[#00FF00] px-4 py-3 text-sm font-black text-[rgb(0,80,0)] shadow-[3px_6px_0_#008000] transition-all duration-100 hover:bg-[#33ff33] active:translate-x-[1px] active:translate-y-[3px] active:shadow-[1px_3px_0_#008000] disabled:cursor-wait disabled:opacity-50"
            onClick={() => void runPrimaryAction()}
          >
            {manualInstallRequested || showIosInstallHelp || installAvailable ? `Install ${appName}` : "Enable web notifications"}
          </button>
        </div>
      </div>
    </div>
  );
}

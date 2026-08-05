import { useEffect, useState } from "react";
import {
  activatePwaUpdate,
  canPromptPwaInstall,
  isEmbeddedWebView,
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
}: {
  onMessage: (kind: "success" | "warning" | "error", message: string) => void;
}) {
  const [installAvailable, setInstallAvailable] = useState(canPromptPwaInstall());
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISSED_KEY) === "1");
  const [busy, setBusy] = useState(false);
  const standalone = isStandaloneDisplay();
  const embedded = isEmbeddedWebView();
  const canPush = "Notification" in window && "PushManager" in window && Notification.permission === "default";
  const showIosInstallHelp = isIos() && !standalone && !embedded;

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

  if (dismissed || embedded || (!installAvailable && !showIosInstallHelp && !canPush)) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
  };

  const runPrimaryAction = async () => {
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
    <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-40 flex w-[calc(100%-2rem)] max-w-sm items-center gap-2 rounded-xl border border-[#00FF00]/60 bg-black/95 p-3 shadow-2xl">
      <button
        type="button"
        disabled={busy}
        className="min-w-0 flex-1 rounded-lg bg-[#00FF00] px-3 py-2 text-sm font-black text-[#003800] disabled:opacity-50"
        onClick={() => void runPrimaryAction()}
      >
        {showIosInstallHelp ? "Install 10X" : installAvailable ? "Install 10X Warplets" : "Enable web notifications"}
      </button>
      <button type="button" className="px-2 py-2 text-xs font-bold text-[#8bbf8b]" onClick={dismiss} aria-label="Dismiss">
        Later
      </button>
    </div>
  );
}

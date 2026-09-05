import { useEffect, useState } from "react";
import sdk from "@farcaster/miniapp-sdk";
import NotificationsPromptModal from "./NotificationsPromptModal";
import { isLikelyBaseAppBrowser } from "./pwa";
import { enableStonkletsNotifications, stonkletsNotificationMode } from "./stonkletsNotifications";

export default function StonkletsNotificationsPrompt({ inMiniApp, onClose, onEnabled, onMessage }: {
  inMiniApp: boolean;
  onClose: () => void;
  onEnabled: () => void;
  onMessage: (message: string, kind: "success" | "error") => void;
}) {
  const mode = stonkletsNotificationMode(inMiniApp, isLikelyBaseAppBrowser());
  const [added, setAdded] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!inMiniApp) return;
    let cancelled = false;
    void sdk.context.then((context) => { if (!cancelled) setAdded(context.client.added); }).catch(() => {});
    return () => { cancelled = true; };
  }, [inMiniApp]);
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const message = await enableStonkletsNotifications(mode);
      if (message) { onEnabled(); onMessage(message, "success"); }
      onClose();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Stonklets notifications could not be enabled. Please try again.", "error");
    } finally { setBusy(false); }
  };
  const promptText = mode === "base" ? undefined : mode === "web"
    ? "Enable browser notifications so you don’t miss Stonklets launches and updates."
    : added ? "Please turn on notifications so you don’t miss Stonklets launches and updates."
      : "Please add Stonklets & enable notifications so you don’t miss launches and updates 👀";
  return <NotificationsPromptModal appName="Stonklets" notificationsOnlyPrompt={added || mode !== "farcaster"} baseAppContext={mode === "base"} promptText={promptText} busy={busy} onClose={onClose} onConfirm={() => void confirm()} />;
}

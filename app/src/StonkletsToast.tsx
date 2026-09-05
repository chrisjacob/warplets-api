import { useEffect, useState } from "react";
import { AppViewport } from "./AppViewport";

export type StonkletsToastMessage = { message: string; kind: "success" | "error" };

export function StonkletsToast({ toast, onClose }: { toast: StonkletsToastMessage; onClose: () => void }) {
  const [exiting, setExiting] = useState(false);
  useEffect(() => {
    setExiting(false);
    const timeout = window.setTimeout(() => setExiting(true), 6000);
    return () => window.clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    if (!exiting) return;
    const timeout = window.setTimeout(onClose, 240);
    return () => window.clearTimeout(timeout);
  }, [exiting, onClose]);
  useEffect(() => () => {
    if (toast.kind !== "error") return;
    // Match Warplets' Safari chrome reset after dismissing a red toast.
    const current = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const replacement = current ?? document.createElement("meta");
    replacement.name = "theme-color";
    replacement.content = "#000000";
    current?.remove();
    document.head.appendChild(replacement);
    document.documentElement.style.backgroundColor = "#000000";
    document.body.style.backgroundColor = "#000000";
  }, [toast.kind]);
  return <AppViewport className={`trade-toast ${toast.kind === "error" ? "trade-toast--danger" : ""} ${exiting ? "trade-toast--exiting" : ""}`} role={toast.kind === "error" ? "alert" : "status"}>
    <div className="flex w-full items-center gap-3">
      <span className="min-w-0 flex-1">{toast.message}</span>
      <button type="button" aria-label="Close message" onClick={() => setExiting(true)} className="trade-toast__close">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>
      </button>
    </div>
  </AppViewport>;
}

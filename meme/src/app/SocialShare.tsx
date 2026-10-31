import { useState, useRef, useEffect } from "react";
import { api } from "./client";
import { qaEnabled, qaPath } from "./qaMode";
import { miniRuntime } from "./miniRuntime";
import { useFeedback } from "./Feedback";
import type { ShareCard, CardKind } from "../shared/shareCards";
export default function SocialShare({
  kind,
  subject,
  window,
  fid,
  sourceHash,
  compact = false,
}: {
  kind: CardKind;
  subject: string;
  window: "24h" | "30d" | "all";
  fid?: number;
  sourceHash?: string;
  compact?: boolean;
}) {
  const notify = useFeedback();
  const [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<string | null>(null),
    [message, setMessage] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (import.meta.env.DEV && preview && !dialog.current?.open)
      dialog.current?.showModal();
  }, [preview]);
  async function share() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const { card } = (await api(
        "/api/meme/shares?" +
          new URLSearchParams({
            kind,
            subject,
            window,
            ...(fid ? { fid: String(fid) } : {}),
            ...(sourceHash ? { sourceHash } : {}),
          }),
      )) as { card: ShareCard | null };
      if (!card) throw Error("Share card isn’t published yet.");
      if (qaEnabled) {
        setPreview(card.id);
        return;
      }
      const url = location.origin + "/api/meme/share/" + card.id,
        runtime = await miniRuntime();
      if (runtime?.capabilities.includes("actions.composeCast"))
        await runtime.sdk.actions.composeCast({
          text: card.title,
          embeds: [url],
        });
      else if (navigator.share)
        await navigator.share({ title: card.title, text: card.title, url });
      else {
        await navigator.clipboard.writeText(url);
        setMessage("Link copied.");
        notify("Link copied.");
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setMessage(e instanceof Error ? e.message : "Couldn’t share. Try again.");
      notify("Couldn’t share. Please try again.", "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="share-control">
      <button
        ref={trigger}
        className={compact ? "compact-share" : ""}
        aria-label={
          busy ? "Preparing…" : kind === "pnl" ? "Share P&L" : "Share"
        }
        disabled={busy}
        onClick={() => void share()}
      >
        {compact ? (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 15V3m-4 4 4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
          </svg>
        ) : busy ? (
          "Preparing…"
        ) : kind === "pnl" ? (
          "Share P&L"
        ) : (
          "Share"
        )}
      </button>
      <span role="status">{message}</span>
      {import.meta.env.DEV && preview && (
        <dialog
          ref={dialog}
          onClose={() => {
            setPreview(null);
            trigger.current?.focus();
          }}
          aria-label="QA share preview"
          className="qa-share"
        >
          <h3>QA share preview</h3>
          <p>Simulated card · nothing is posted.</p>
          <img
            src={qaPath("/api/meme/share/" + preview + "/mini.png")}
            alt="Simulated performance share card"
          />
          <div className="qa-buttons">
            <a
              download="10x-simulated-card.png"
              href={qaPath("/api/meme/share/" + preview + "/mini.png")}
            >
              Download PNG
            </a>
            <button autoFocus onClick={() => dialog.current?.close()}>
              Close preview
            </button>
          </div>
        </dialog>
      )}
    </div>
  );
}

import { useState } from "react";
import { api } from "./client";
import { qaEnabled, qaPath } from "./qaMode";
import { miniRuntime } from "./miniRuntime";
import type { ShareCard, CardKind } from "../shared/shareCards";
export default function SocialShare({
  kind,
  subject,
  window,
  fid,
  sourceHash,
}: {
  kind: CardKind;
  subject: string;
  window: "24h" | "30d" | "all";
  fid?: number;
  sourceHash?: string;
}) {
  const [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<string | null>(null),
    [message, setMessage] = useState("");
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
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setMessage(e instanceof Error ? e.message : "Couldn’t share. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="share-control">
      <button disabled={busy} onClick={() => void share()}>
        {busy ? "Preparing…" : kind === "pnl" ? "Share P&L" : "Share"}
      </button>
      <span role="status">{message}</span>
      {preview && (
        <dialog open aria-label="QA share preview" className="qa-share">
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
            <button autoFocus onClick={() => setPreview(null)}>
              Close preview
            </button>
          </div>
        </dialog>
      )}
    </div>
  );
}

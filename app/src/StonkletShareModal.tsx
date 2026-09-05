import ProgressiveStonkletImage from "./ProgressiveStonkletImage";
import { useEffect, useId, useRef, useState } from "react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { AppViewport } from "./AppViewport";
import { composeFarcasterPost, openAppUrl } from "./surfaceAdapter";
import { stonkletShare } from "../shared/stonkletsShare";
import type { StonkletCatalogEntry } from "../shared/stonkletsCatalog";
import type { StonkletChangeRange } from "../shared/stonkletsTime";

const smallButton = "flex h-6 cursor-pointer items-center justify-center rounded-md border border-[#00FF00]/35 bg-black px-2.5 text-[11px] font-black text-[#00FF00] shadow-[2px_3px_0_#008000] hover:bg-[#041204] disabled:opacity-40";
const shareButton = "w-full cursor-pointer rounded-[20px] border border-[#009900] bg-[#00FF00] px-3 py-3 text-sm font-bold text-[rgb(0,80,0)] shadow-[3px_6px_0_#008000] hover:bg-[#33ff33]";

export default function StonkletShareModal({ entry, range, onClose, onMessage }: {
  entry: StonkletCatalogEntry; range: StonkletChangeRange; onClose: () => void; onMessage: (text: string, kind: "success" | "error") => void;
}) {
  const share = stonkletShare(entry, location.hostname, range);
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [retry, setRetry] = useState(0);
  const [chartImage, setChartImage] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [failed, setFailed] = useState<Set<number>>(new Set());
  const [loaded, setLoaded] = useState<Set<number>>(new Set());
  const [snapshotCountdown, setSnapshotCountdown] = useState<number | null>(25);
  const renderingChart = !loaded.has(0) && !failed.has(0);
  useEffect(() => {
    if (!renderingChart) { setSnapshotCountdown(null); return; }
    setSnapshotCountdown(25);
    let remainingSeconds = 25;
    const timer = window.setInterval(() => {
      remainingSeconds -= 1;
      setSnapshotCountdown(remainingSeconds > 0 ? remainingSeconds : null);
      if (remainingSeconds <= 0) window.clearInterval(timer);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [renderingChart, retry]);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setChartImage(null);
    setLoaded(new Set());
    setFailed(new Set());
    const deadline = Date.now() + 120_000;
    const timeout = window.setTimeout(() => controller.abort(), 120_000);
    let disposed = false;
    const render = async () => {
      while (!controller.signal.aborted && Date.now() < deadline) {
        const response = await fetch(share.image, { signal: controller.signal });
        if (response.status === 202) {
          await response.body?.cancel();
          await new Promise<void>((resolve, reject) => {
            const abort = () => { clearTimeout(timer); reject(new Error("Render cancelled")); };
            const timer = window.setTimeout(() => { controller.signal.removeEventListener("abort", abort); resolve(); }, 2_000);
            controller.signal.addEventListener("abort", abort, { once: true });
            if (controller.signal.aborted) abort();
          });
          continue;
        }
        if (!response.ok || !response.headers.get("content-type")?.includes("image/png")) throw new Error("Render failed");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setChartImage(objectUrl);
        return;
      }
      throw new Error("Render timed out");
    };
    void render().catch(() => { if (!disposed) setFailed((current) => new Set(current).add(0)); }).finally(() => clearTimeout(timeout));
    return () => { disposed = true; clearTimeout(timeout); controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [share.image, retry]);
  const images = [{ src: share.image, label: "Compare chart" }, { src: share.artwork, label: `${entry.stonklet.name} artwork` }];
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const focusable = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]') ?? []);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); document.body.style.overflow = overflow; previous?.focus(); };
  }, [onClose]);
  const run = (action: Promise<unknown>, success?: string) => void action.then(() => { if (success) onMessage(success, "success"); }).catch((error) => onMessage(error instanceof Error ? error.message : "Sharing failed. Please try again.", "error"));
  const copyPost = async () => {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(share.text);
    const textarea = document.createElement("textarea");
    textarea.value = share.text; document.body.appendChild(textarea); textarea.select();
    const copied = document.execCommand("copy"); textarea.remove();
    if (!copied) throw new Error("Copy is unavailable. Select and copy the post text.");
  };
  const copyImage = async (index: number) => {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("Use Download to open the image, then press and hold to copy or save it.");
    setBusy(index);
    try {
      const source = new URL(images[index]!.src);
      // Fetch compressed artwork; convert to PNG only when the clipboard needs it.
      const blob = fetch(index === 0 && chartImage ? chartImage : `${source.pathname}${source.search}`).then(async (response) => {
        if (!response.ok) throw new Error("Image unavailable. Please retry.");
        const image = await response.blob();
        if (image.type === "image/png") return image;
        const bitmap = await createImageBitmap(image);
        try {
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width; canvas.height = bitmap.height;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Image copying is unavailable.");
          context.drawImage(bitmap, 0, 0);
          return await new Promise<Blob>((resolve, reject) => canvas.toBlob((png) => png ? resolve(png) : reject(new Error("Image conversion failed.")), "image/png"));
        } finally { bitmap.close(); }
      });
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    } catch { throw new Error("This browser did not allow image copying. Use Download, then press and hold to copy or save the image."); }
    finally { setBusy(null); }
  };
  return <AppViewport className="app-modal-viewport fixed inset-0 z-[90] flex items-end justify-center bg-black/80 p-4 sm:items-center" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className="app-modal-panel flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[#00FF00]/35 bg-black shadow-2xl">
      <div className="app-modal-header flex items-center justify-between gap-3 border-b border-[#00FF00]/20 bg-black px-4 py-3">
        <h2 id={titleId} className="min-w-0 truncate text-base font-bold text-[#8bbf8b]"><span className="text-[#00FF00]">Share</span> {entry.stonklet.name}</h2>
        <button type="button" aria-label="Close share preview" title="Close" onClick={onClose} className="identity-link-close"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
      </div>
      <OverlayScrollbarsComponent className="app-modal-scroll-body overflow-auto px-4 py-4" defer options={{ scrollbars: { theme: "os-theme-10x", autoHide: "scroll", clickScroll: true } }}>
        <div className="rounded-xl border border-[#00FF00]/25 bg-[#041204]/80 p-3">
          <div className="mb-2 flex items-center justify-between"><b className="text-xs uppercase text-[#00FF00]">Post</b><button type="button" className={smallButton} onClick={() => run(copyPost(), "Post copied.")}>Copy</button></div>
          <pre className="select-text whitespace-pre-wrap break-words font-sans text-sm leading-snug text-[#8bbf8b]"><strong>{share.title}</strong>{share.text.slice(share.title.length)}</pre>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">{images.map((image, index) => <div key={image.src}>
          <div className="relative aspect-square overflow-hidden rounded-lg border border-[#00FF00]/25 bg-black">
            {!loaded.has(index) && !failed.has(index) && <div role="status" className="absolute inset-0 flex flex-col items-center justify-center bg-[#041204]/80 p-3 text-center text-xs font-bold text-[#8bbf8b]">
              <span className="block h-9 w-9 animate-spin rounded-full border-2 border-[#00FF00]/25 border-t-[#00FF00]" aria-hidden="true" />
              <span className="mt-3">{index === 0 ? "Rendering chart…" : "Loading artwork…"}{index === 0 && snapshotCountdown != null && <span aria-hidden="true"> {snapshotCountdown}</span>}</span>
            </div>}
            {!failed.has(index) && index === 1 && <ProgressiveStonkletImage src={image.src} alt={image.label} className="h-full w-full" onLoad={() => setLoaded((current) => new Set(current).add(index))} onError={() => setFailed((current) => new Set(current).add(index))} />}
            {!failed.has(index) && index === 0 && chartImage && <img src={index === 0 ? chartImage! : `${image.src}${image.src.includes("?") ? "&" : "?"}retry=${retry}`} alt={image.label} className="h-full w-full object-contain" onLoad={() => setLoaded((current) => new Set(current).add(index))} onError={() => setFailed((current) => new Set(current).add(index))} />}
            {failed.has(index) && <button className="h-full w-full p-3 text-xs text-[#00FF00]" onClick={() => { setFailed(new Set()); setLoaded(new Set()); setRetry((value) => value + 1); }}>Image unavailable. Retry</button>}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2"><button type="button" className={smallButton} disabled={!loaded.has(index) || busy !== null} onClick={() => run(copyImage(index), "Image copied.")}>{busy === index ? "Copying…" : "Copy"}</button><button type="button" className={smallButton} disabled={!loaded.has(index)} onClick={() => run(openAppUrl(image.src), "Image opened. Use your browser controls to save it.")}>Download</button></div>
        </div>)}</div>
      </OverlayScrollbarsComponent>
      <div className="app-modal-footer grid grid-cols-2 gap-2 border-t border-[#00FF00]/20 bg-black px-4 py-3"><button className={shareButton} onClick={() => run(composeFarcasterPost(share.text, [share.url]))}>Share on Farcaster</button><button className={shareButton} onClick={() => run(openAppUrl(`https://twitter.com/intent/tweet?text=${encodeURIComponent(share.text)}`))}>Share on X (Twitter)</button></div>
    </div>
  </AppViewport>;
}

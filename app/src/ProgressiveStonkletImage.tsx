import { useEffect, useState } from "react";

export function stonkletThumbnail(src: string): string {
  return src.includes("/stonklets/stonklets/") && !src.includes("/thumbs/") && /\.webp(?:[?#]|$)/i.test(src)
    ? src.replace("/stonklets/stonklets/", "/stonklets/stonklets/thumbs/512/") : src;
}

function ProgressiveImage({ src, alt, className, onLoad, onError }: { src: string; alt: string; className?: string; onLoad?: () => void; onError?: () => void }) {
  const thumbnail = stonkletThumbnail(src);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [fullReady, setFullReady] = useState(false);
  const [settled, setSettled] = useState(false);
  // Slow or failed originals must not stall a server-rendered snapshot forever.
  useEffect(() => {
    if (!previewReady || settled) return;
    const timer = setTimeout(() => { setSettled(true); if (previewFailed) onError?.(); else onLoad?.(); }, 15_000);
    return () => clearTimeout(timer);
  }, [previewReady, settled]);
  return <span className={`relative block overflow-hidden ${className ?? ""}`} data-artwork-ready={settled}>
    <img src={thumbnail} alt={alt} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover"
      onLoad={() => { setPreviewReady(true); if (thumbnail === src) { setFullReady(true); setSettled(true); onLoad?.(); } }}
      onError={() => { setPreviewFailed(true); setPreviewReady(true); if (thumbnail === src) { setSettled(true); onError?.(); } }} />
    {previewReady && thumbnail !== src && <img src={src} alt="" aria-hidden="true" loading="lazy" decoding="async" fetchPriority="low"
      className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${fullReady ? "opacity-100" : "opacity-0"}`}
      onLoad={() => { setFullReady(true); setSettled(true); onLoad?.(); }}
      onError={() => { setSettled(true); if (previewFailed) onError?.(); else onLoad?.(); }} />}
  </span>;
}

export default function ProgressiveStonkletImage(props: Parameters<typeof ProgressiveImage>[0]) {
  return <ProgressiveImage key={props.src} {...props} />;
}

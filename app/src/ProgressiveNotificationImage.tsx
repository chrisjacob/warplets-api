import { useEffect, useState } from "react";

const HIGH_RESOLUTION_RETRY_DELAYS_MS = [1200, 3000] as const;

export function getRetriedImageUrl(src: string, attempt: number): string {
  if (attempt <= 0) return src;
  const url = new URL(src, typeof window === "undefined" ? "https://10x.invalid" : window.location.origin);
  url.searchParams.set("10x-image-retry", String(attempt));
  return /^https?:\/\//i.test(src) ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
}

export default function ProgressiveNotificationImage({
  highResolutionSrc,
  fallbackSrc,
  revealPercent,
  alt = "",
  onReady,
}: {
  highResolutionSrc: string;
  fallbackSrc: string;
  revealPercent: number;
  alt?: string;
  onReady?: () => void;
}) {
  const [fallbackReady, setFallbackReady] = useState(false);
  const [highResolutionReady, setHighResolutionReady] = useState(false);
  const [highResolutionFailed, setHighResolutionFailed] = useState(false);
  const [highResolutionAttempt, setHighResolutionAttempt] = useState(0);
  const imageReady = fallbackReady || highResolutionReady;

  useEffect(() => {
    setFallbackReady(false);
    setHighResolutionReady(false);
    setHighResolutionFailed(false);
    setHighResolutionAttempt(0);
  }, [fallbackSrc, highResolutionSrc]);

  useEffect(() => {
    if (!highResolutionFailed || highResolutionReady) return;
    const delay = HIGH_RESOLUTION_RETRY_DELAYS_MS[highResolutionAttempt];
    if (delay == null) return;
    const timeoutId = window.setTimeout(() => {
      setHighResolutionFailed(false);
      setHighResolutionAttempt((current) => current + 1);
    }, delay);
    return () => window.clearTimeout(timeoutId);
  }, [highResolutionAttempt, highResolutionFailed, highResolutionReady]);

  return (
    <div
      className="relative h-full w-full"
      style={{
        clipPath: `inset(0 ${100 - revealPercent}% 0 0)`,
        willChange: "clip-path",
      }}
    >
      {!imageReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-[rgba(0,255,0,0.12)]">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#00FF00]/25 border-t-[#00FF00]" aria-label="Loading 10X Warplet image" />
        </div>
      )}
      <img
        src={fallbackSrc}
        alt={alt}
        loading="eager"
        decoding="async"
        onLoad={() => {
          setFallbackReady(true);
          onReady?.();
        }}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${fallbackReady ? "opacity-100" : "opacity-0"}`}
      />
      <img
        key={highResolutionAttempt}
        src={getRetriedImageUrl(highResolutionSrc, highResolutionAttempt)}
        alt={alt}
        loading="eager"
        decoding="async"
        onLoad={() => {
          setHighResolutionReady(true);
          setHighResolutionFailed(false);
          onReady?.();
        }}
        onError={() => setHighResolutionFailed(true)}
        className={`absolute inset-0 z-[1] h-full w-full object-cover transition-opacity duration-300 ${highResolutionReady ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}

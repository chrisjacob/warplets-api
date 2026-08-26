import { useCallback, useEffect, useRef, useState } from "react";

const HIGH_RESOLUTION_RETRY_DELAYS_MS = [1200, 3000] as const;
const FALLBACK_RETRY_DELAYS_MS = [500, 1500] as const;
const IMAGE_REQUEST_TIMEOUT_MS = 3500;
const LAST_RESORT_REVEAL_MS = 1800;
const READY_FAIL_OPEN_MS = 2500;
const LAST_RESORT_SRC = "/splash_search.png";

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
  const [fallbackFailed, setFallbackFailed] = useState(false);
  const [fallbackAttempt, setFallbackAttempt] = useState(0);
  const [highResolutionReady, setHighResolutionReady] = useState(false);
  const [highResolutionFailed, setHighResolutionFailed] = useState(false);
  const [highResolutionAttempt, setHighResolutionAttempt] = useState(0);
  const [lastResortEnabled, setLastResortEnabled] = useState(false);
  const [lastResortReady, setLastResortReady] = useState(false);
  const fallbackImageRef = useRef<HTMLImageElement | null>(null);
  const highResolutionImageRef = useRef<HTMLImageElement | null>(null);
  const lastResortImageRef = useRef<HTMLImageElement | null>(null);
  const hasReportedReadyRef = useRef(false);
  const onReadyRef = useRef(onReady);
  const imageReady = fallbackReady || highResolutionReady || (lastResortEnabled && lastResortReady);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  const reportReady = useCallback(() => {
    if (hasReportedReadyRef.current) return;
    hasReportedReadyRef.current = true;
    onReadyRef.current?.();
  }, []);

  useEffect(() => {
    setFallbackReady(false);
    setFallbackFailed(false);
    setFallbackAttempt(0);
    setHighResolutionReady(false);
    setHighResolutionFailed(false);
    setHighResolutionAttempt(0);
    setLastResortEnabled(false);
    setLastResortReady(false);
    hasReportedReadyRef.current = false;
  }, [fallbackSrc, highResolutionSrc]);

  useEffect(() => {
    if (imageReady) reportReady();
  }, [imageReady, reportReady]);

  // iOS WKWebView can leave an image request pending without firing either
  // load or error. Never let that stall the modal's reveal and typewriter.
  useEffect(() => {
    const timeoutId = window.setTimeout(reportReady, READY_FAIL_OPEN_MS);
    return () => window.clearTimeout(timeoutId);
  }, [fallbackSrc, highResolutionSrc, reportReady]);

  useEffect(() => {
    if (fallbackReady || highResolutionReady) return;
    const timeoutId = window.setTimeout(() => setLastResortEnabled(true), LAST_RESORT_REVEAL_MS);
    return () => window.clearTimeout(timeoutId);
  }, [fallbackReady, highResolutionReady]);

  useEffect(() => {
    const image = fallbackImageRef.current;
    if (image?.complete && image.naturalWidth > 0) setFallbackReady(true);
  }, [fallbackAttempt, fallbackSrc]);

  useEffect(() => {
    const image = highResolutionImageRef.current;
    if (image?.complete && image.naturalWidth > 0) setHighResolutionReady(true);
  }, [highResolutionAttempt, highResolutionSrc]);

  useEffect(() => {
    const image = lastResortImageRef.current;
    if (image?.complete && image.naturalWidth > 0) setLastResortReady(true);
  }, []);

  useEffect(() => {
    if (fallbackReady || fallbackFailed) return;
    const timeoutId = window.setTimeout(() => setFallbackFailed(true), IMAGE_REQUEST_TIMEOUT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [fallbackAttempt, fallbackFailed, fallbackReady]);

  useEffect(() => {
    if (!fallbackFailed || fallbackReady) return;
    const delay = FALLBACK_RETRY_DELAYS_MS[fallbackAttempt];
    if (delay == null) return;
    const timeoutId = window.setTimeout(() => {
      setFallbackFailed(false);
      setFallbackAttempt((current) => current + 1);
    }, delay);
    return () => window.clearTimeout(timeoutId);
  }, [fallbackAttempt, fallbackFailed, fallbackReady]);

  useEffect(() => {
    if (highResolutionReady || highResolutionFailed) return;
    const timeoutId = window.setTimeout(() => setHighResolutionFailed(true), IMAGE_REQUEST_TIMEOUT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [highResolutionAttempt, highResolutionFailed, highResolutionReady]);

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
        ref={lastResortImageRef}
        src={LAST_RESORT_SRC}
        alt={alt}
        loading="eager"
        decoding="async"
        onLoad={() => setLastResortReady(true)}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${lastResortEnabled && lastResortReady ? "opacity-100" : "opacity-0"}`}
      />
      <img
        ref={fallbackImageRef}
        key={fallbackAttempt}
        src={getRetriedImageUrl(fallbackSrc, fallbackAttempt)}
        alt={alt}
        loading="eager"
        decoding="async"
        onLoad={() => {
          setFallbackReady(true);
          setFallbackFailed(false);
        }}
        onError={() => setFallbackFailed(true)}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${fallbackReady ? "opacity-100" : "opacity-0"}`}
      />
      <img
        ref={highResolutionImageRef}
        key={highResolutionAttempt}
        src={getRetriedImageUrl(highResolutionSrc, highResolutionAttempt)}
        alt={alt}
        loading="eager"
        decoding="async"
        onLoad={() => {
          setHighResolutionReady(true);
          setHighResolutionFailed(false);
        }}
        onError={() => setHighResolutionFailed(true)}
        className={`absolute inset-0 z-[1] h-full w-full object-cover transition-opacity duration-300 ${highResolutionReady ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}

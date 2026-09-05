import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { getAppScale } from "./AppViewport";
import type { PartialOptions } from "overlayscrollbars";
import { useOverlayScrollbars } from "overlayscrollbars-react";

type MiniAppShellProps = {
  children: ReactNode;
};

type NetworkConnection = EventTarget & {
  saveData?: boolean;
};

type NavigatorWithConnection = Navigator & {
  connection?: NetworkConnection;
};

export function getVisualViewportMetrics(
  viewportHeight: number | undefined,
  viewportOffsetTop: number | undefined,
  fallbackHeight: number,
) {
  const height = Number.isFinite(viewportHeight) && Number(viewportHeight) > 0
    ? Number(viewportHeight)
    : fallbackHeight;
  const offsetTop = Number.isFinite(viewportOffsetTop) && Number(viewportOffsetTop) > 0
    ? Number(viewportOffsetTop)
    : 0;

  return {
    height: `${Math.max(1, Math.round(height))}px`,
    offsetTop: `${Math.max(0, Math.round(offsetTop))}px`,
  };
}

export function shouldSkipBackgroundVideo(
  prefersReducedMotion: boolean,
  saveData = false,
  prefersReducedData = false,
) {
  return prefersReducedMotion || saveData || prefersReducedData;
}

function shouldLoadBackgroundVideoNow() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }

  const connection = (navigator as NavigatorWithConnection).connection;
  return !shouldSkipBackgroundVideo(
    window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    connection?.saveData === true,
    window.matchMedia("(prefers-reduced-data: reduce)").matches,
  );
}

const BODY_SCROLLBAR_OPTIONS = {
  update: {
    debounce: {
      mutation: [0, 33],
      // ResizeObserver updates are immediate by default. Mobile viewport chrome
      // and small layout observations can therefore recalculate the thumb
      // between adjacent scroll frames. Let the size settle before measuring.
      resize: 100,
      event: [33, 99],
      env: [222, 666, true],
    },
  },
  scrollbars: {
    theme: "os-theme-10x",
    autoHide: "scroll",
    clickScroll: true,
  },
} satisfies PartialOptions;

export default function MiniAppShell({ children }: MiniAppShellProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [loadBackgroundVideo, setLoadBackgroundVideo] = useState(
    shouldLoadBackgroundVideoNow,
  );
  const [initializeBodyScrollbars] = useOverlayScrollbars({
    // Keep this reference stable. The adapter force-applies changed option
    // objects to the live body instance, which can reset the thumb geometry
    // between scroll frames when the shell rerenders.
    options: BODY_SCROLLBAR_OPTIONS,
    defer: true,
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-overlayscrollbars-initialize", "");
    document.body.setAttribute("data-overlayscrollbars-initialize", "");
    initializeBodyScrollbars(document.body);
    return () => {
      document.documentElement.removeAttribute("data-overlayscrollbars-initialize");
      document.body.removeAttribute("data-overlayscrollbars-initialize");
    };
  }, [initializeBodyScrollbars]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let animationFrameId = 0;

    const syncStickyOffset = () => {
      const scale = getAppScale(document.documentElement.clientWidth);
      // Native sticky offsets use layout pixels, while document scrolling uses
      // screen pixels. Compensate without moving scrolling into a new element.
      pageRef.current?.style.setProperty("--app-sticky-scroll-correction", `${window.scrollY * (1 / scale - 1)}px`);
    };

    const applyVisualViewport = () => {
      const scale = getAppScale(document.documentElement.clientWidth);
      const metrics = getVisualViewportMetrics(
        viewport?.height,
        viewport?.offsetTop,
        window.innerHeight,
      );
      root.style.setProperty("--app-visual-viewport-height", metrics.height);
      root.style.setProperty("--app-visual-viewport-offset-top", metrics.offsetTop);
      root.style.setProperty("--app-scale", String(scale));
      root.style.setProperty("--app-layout-viewport-height", `${window.innerHeight / scale}px`);
      root.style.setProperty("--app-overlay-width", `${document.documentElement.clientWidth / scale}px`);
      root.style.setProperty("--app-overlay-height", `${parseFloat(metrics.height) / scale}px`);
      root.style.setProperty("--app-overlay-offset-top", `${parseFloat(metrics.offsetTop) / scale}px`);
      syncStickyOffset();
      if (shellRef.current && pageRef.current) {
        shellRef.current.style.height = `${pageRef.current.getBoundingClientRect().height}px`;
      }
    };
    const scheduleVisualViewportSync = () => {
      window.cancelAnimationFrame(animationFrameId);
      animationFrameId = window.requestAnimationFrame(applyVisualViewport);
    };

    applyVisualViewport();
    const pageObserver = new ResizeObserver(applyVisualViewport);
    if (pageRef.current) pageObserver.observe(pageRef.current);
    viewport?.addEventListener("resize", scheduleVisualViewportSync);
    viewport?.addEventListener("scroll", scheduleVisualViewportSync);
    window.addEventListener("resize", scheduleVisualViewportSync);
    window.addEventListener("orientationchange", scheduleVisualViewportSync);
    window.addEventListener("scroll", syncStickyOffset, { passive: true });

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      pageObserver.disconnect();
      viewport?.removeEventListener("resize", scheduleVisualViewportSync);
      viewport?.removeEventListener("scroll", scheduleVisualViewportSync);
      window.removeEventListener("resize", scheduleVisualViewportSync);
      window.removeEventListener("orientationchange", scheduleVisualViewportSync);
      window.removeEventListener("scroll", syncStickyOffset);
      root.style.removeProperty("--app-visual-viewport-height");
      root.style.removeProperty("--app-visual-viewport-offset-top");
      for (const property of ["--app-scale", "--app-layout-viewport-height", "--app-overlay-width", "--app-overlay-height", "--app-overlay-offset-top"]) root.style.removeProperty(property);
    };
  }, []);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const reducedData = window.matchMedia("(prefers-reduced-data: reduce)");
    const connection = (navigator as NavigatorWithConnection).connection;

    const syncVideoPreference = () => {
      setLoadBackgroundVideo(
        !shouldSkipBackgroundVideo(
          reducedMotion.matches,
          connection?.saveData === true,
          reducedData.matches,
        ),
      );
    };

    reducedMotion.addEventListener("change", syncVideoPreference);
    reducedData.addEventListener("change", syncVideoPreference);
    connection?.addEventListener("change", syncVideoPreference);

    return () => {
      reducedMotion.removeEventListener("change", syncVideoPreference);
      reducedData.removeEventListener("change", syncVideoPreference);
      connection?.removeEventListener("change", syncVideoPreference);
    };
  }, []);

  return (
    <div
      className="miniapp-shell"
      ref={shellRef}
      style={{ fontFamily: '"Roboto Mono", system-ui, sans-serif' }}
    >
      <div className="miniapp-shell__outer-glow" aria-hidden="true" />
      <div className="miniapp-shell__inner" ref={pageRef}>
        <div className="miniapp-shell__video-layer" aria-hidden="true">
          <video
            src={loadBackgroundVideo ? "/matrix_bg_500x500_v2.mp4" : undefined}
            poster={
              loadBackgroundVideo
                ? undefined
                : "/matrix_bg_500x500_poster.webp"
            }
            autoPlay
            loop
            muted
            playsInline
            preload={loadBackgroundVideo ? "auto" : "none"}
            aria-hidden="true"
            className="miniapp-shell__video"
          />
          <div className="miniapp-shell__video-bottom-fade" aria-hidden="true" />
        </div>
        <div className="miniapp-shell__inner-glow" aria-hidden="true" />
        <div className="miniapp-shell__content">{children}</div>
      </div>
    </div>
  );
}

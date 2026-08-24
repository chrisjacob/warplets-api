import { useEffect, useState, type ReactNode } from "react";
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
      style={{ fontFamily: '"Roboto Mono", system-ui, sans-serif' }}
    >
      <div className="miniapp-shell__outer-glow" aria-hidden="true" />
      <div className="miniapp-shell__inner">
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

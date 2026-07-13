import { useEffect, type ReactNode } from "react";
import { useOverlayScrollbars } from "overlayscrollbars-react";

type MiniAppShellProps = {
  children: ReactNode;
};

export default function MiniAppShell({ children }: MiniAppShellProps) {
  const [initializeBodyScrollbars] = useOverlayScrollbars({
    options: {
      scrollbars: {
        theme: "os-theme-10x",
        autoHide: "scroll",
        clickScroll: true,
      },
    },
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

  return (
    <div
      className="miniapp-shell"
      style={{ fontFamily: '"Roboto Mono", system-ui, sans-serif' }}
    >
      <div className="miniapp-shell__outer-glow" aria-hidden="true" />
      <div className="miniapp-shell__inner">
        <div className="miniapp-shell__video-layer" aria-hidden="true">
          <video
            src="/matrix_bg_1080x1080.mp4"
            autoPlay
            loop
            muted
            playsInline
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

import type { MouseEvent, ReactNode } from "react";

type LegalRouteState = {
  legalNavigation?: {
    from10x: true;
    fromPath: string;
  };
};

function navigateToLegalPage(event: MouseEvent<HTMLAnchorElement>, path: "/terms" | "/privacy") {
  if (
    event.defaultPrevented
    || event.button !== 0
    || event.metaKey
    || event.ctrlKey
    || event.shiftKey
    || event.altKey
  ) {
    return;
  }

  event.preventDefault();
  const state = (window.history.state ?? {}) as LegalRouteState;
  window.history.pushState(
    {
      ...state,
      legalNavigation: {
        from10x: true,
        fromPath: window.location.pathname,
      },
    },
    "",
    path,
  );
  window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
  window.scrollTo({ top: 0, behavior: "instant" });
}

export default function SiteFooter({ legalSuffix }: { legalSuffix?: ReactNode }) {
  return (
    <footer className="relative z-10 mx-auto w-full max-w-md px-4 pb-8 pt-0 text-center text-[11px] leading-5 text-[#8bbf8b]">
      <p>© 2026 Code Hunt Pty. Ltd. All rights reserved.</p>
      <p className="mt-1">
        <a
          href="/terms"
          className="font-bold text-[#00FF00] underline decoration-[#00FF00] underline-offset-2 hover:text-[#8bff8b]"
          onClick={(event) => navigateToLegalPage(event, "/terms")}
        >
          Terms of Service
        </a>
        <span aria-hidden="true"> ｜ </span>
        <a
          href="/privacy"
          className="font-bold text-[#00FF00] underline decoration-[#00FF00] underline-offset-2 hover:text-[#8bff8b]"
          onClick={(event) => navigateToLegalPage(event, "/privacy")}
        >
          Privacy Policy
        </a>
        {legalSuffix && <><span aria-hidden="true"> ｜ </span>{legalSuffix}</>}
      </p>
    </footer>
  );
}

import { useEffect, useRef, useState } from "react";
import { useOverlayScrollbars } from "overlayscrollbars-react";
import { AppViewport } from "./AppViewport";
import { hapticPrimaryTap, hapticSelectionChanged, hapticTap } from "./haptics";
// Reuse the existing onboarding styles and modal primitives used by Stonklets.
import "./stonkletsOnboarding.css";

const slides = [
  {
    title: "One post. A real shot.",
    lines: [
      "One focused daily feed for crypto. Bring one great post every 24 hours.",
      "Original posts and quotes get a real chance to be seen.",
      "Warplet holdings and levels can boost your points and post ranking.",
    ],
  },
  {
    title: "Earn attention together.",
    lines: [
      "Explore the feed, contribute useful comments and help good ideas spread.",
      "Check in on Base to build a daily streak.",
      "See exactly how your contributions and holdings boost your points.",
    ],
  },
  {
    title: "Your wallet is enough.",
    lines: [
      "Start with your wallet, text and links. Connect Farcaster for your profile.",
      "Open the mini app for photos and video, add it and enable notifications.",
      "Approve a signer for seamless Farcaster posts and reactions.",
    ],
  },
];

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

export default function SocialOnboarding({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const [characters, setCharacters] = useState(0);
  const reduced = useReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [initializeScrollbars, getScrollbars] = useOverlayScrollbars({
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
    const target = body.current;
    if (!target) return;
    target.setAttribute("data-overlayscrollbars-initialize", "");
    initializeScrollbars(target);
    return () => {
      target.removeAttribute("data-overlayscrollbars-initialize");
    };
  }, [initializeScrollbars]);
  const heading = useRef<HTMLHeadingElement>(null);
  const slide = slides[index]!;
  const total = slide.title.length + slide.lines.join("").length;
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focus = (event: FocusEvent) => {
      if (!panel.current?.contains(event.target as Node))
        heading.current?.focus();
    };
    document.addEventListener("focusin", focus);
    return () => {
      document.removeEventListener("focusin", focus);
      document.body.style.overflow = overflow;
      requestAnimationFrame(() => {
        if (previous?.isConnected) previous.focus();
        else {
          // The account menu is unmounted during replay. Restore focus to the
          // destination only if no following notice/notification gate is open.
          const destination =
            document.querySelector<HTMLElement>(".social-main");
          if (destination) {
            destination.setAttribute("tabindex", "-1");
            destination.focus({ preventScroll: true });
          }
        }
      });
    };
  }, []);
  useEffect(() => {
    heading.current?.focus();
    (getScrollbars()?.elements().viewport ?? body.current)?.scrollTo({
      top: 0,
    });
    setCharacters(0);
    if (reduced) return;
    let frame = 0;
    const start = performance.now() + (index === 0 ? 1500 : 0);
    const tick = (now: number) => {
      const next = Math.max(0, Math.min(total, Math.floor((now - start) / 38)));
      setCharacters(next);
      if (next < total) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [index, total, reduced, getScrollbars]);
  const typed = (text: string, offset: number) => (
    <span className="stonk-onboard-typed">
      <span className="sr-only">{text}</span>
      <span className="stonk-onboard-reserved" aria-hidden="true">
        {text}
      </span>
      <span className="stonk-onboard-visible" aria-hidden="true">
        {text.slice(
          0,
          reduced ? text.length : Math.max(0, characters - offset),
        )}
        {index === 0 && offset === 0 && characters === 0 && !reduced && (
          <span className="onboarding-terminal-cursor" />
        )}
      </span>
    </span>
  );
  const navigate = (next: number) => {
    void hapticSelectionChanged();
    setIndex(next);
  };
  return (
    <AppViewport
      className="app-modal-viewport stonk-onboard fixed inset-0 z-[210] flex items-end justify-center bg-black/80 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="social-onboard-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
        }
        if (event.key !== "Tab") return;
        const elements = Array.from(
          panel.current?.querySelectorAll<HTMLElement>(
            "button:not([disabled]), a[href]",
          ) ?? [],
        );
        const first = elements[0],
          last = elements[elements.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === heading.current)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <div
        ref={panel}
        className="app-modal-panel flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[#00FF00]/35 bg-black shadow-2xl"
      >
        <header className="app-modal-header border-b border-[#00FF00]/20 px-4 py-3">
          <h2
            id="social-onboard-title"
            ref={heading}
            tabIndex={-1}
            className="text-base font-bold text-[#00FF00] outline-none"
          >
            {typed(slide.title, 0)}
          </h2>
        </header>
        <div
          ref={body}
          className="app-modal-scroll-body min-h-0 flex-1 overflow-y-auto p-4"
        >
          {/* OverlayScrollbars reparents this stable wrapper; React owns its changing children. */}
          <div>
            <div key={index}>
              <div className="stonk-onboard-art">
                <img
                  src={index === 0 ? "/embed.png" : "/icon.png"}
                  alt={
                    index === 0
                      ? "10X Social ? #1 Feed for Crypto"
                      : "10X Social"
                  }
                />
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {slide.lines.map((line, lineIndex) => (
                <p
                  key={line}
                  className="rounded-lg border border-[#00FF00]/15 bg-[#041204] px-3 py-2 text-sm leading-relaxed text-[#8bbf8b]"
                >
                  {typed(
                    line,
                    slide.title.length +
                      slide.lines.slice(0, lineIndex).join("").length,
                  )}
                </p>
              ))}
            </div>
          </div>
        </div>
        <footer className="app-modal-footer border-t border-[#00FF00]/20 p-4">
          <nav
            className="mb-4 flex justify-center gap-1.5"
            aria-label="Onboarding slides"
          >
            {slides.map((item, i) => (
              <button
                key={item.title}
                type="button"
                aria-label={`Go to onboarding slide ${i + 1}`}
                aria-current={i === index ? "step" : undefined}
                onClick={() => navigate(i)}
                className="stonk-onboard-dot"
              >
                <span className={i === index ? "is-active" : ""} />
              </button>
            ))}
          </nav>
          <div className="stonk-onboard-actions">
            {index > 0 && (
              <button
                type="button"
                className="secondary-trade-cta flex-1 cursor-pointer rounded-[20px] border bg-black px-4 py-3 text-sm font-bold text-[#00FF00] transition-all duration-100 hover:bg-[#041204] active:translate-x-[1px] active:translate-y-[3px]"
                onClick={() => {
                  void hapticTap();
                  setIndex(index - 1);
                }}
              >
                Back
              </button>
            )}
            <button
              type="button"
              className="stonk-onboard-next"
              onClick={() => {
                void hapticPrimaryTap();
                if (index === slides.length - 1) onDone();
                else setIndex(index + 1);
              }}
            >
              {index === slides.length - 1 ? "Explore the feed" : "Next"}
            </button>
          </div>
        </footer>
      </div>
    </AppViewport>
  );
}

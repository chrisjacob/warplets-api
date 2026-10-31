import { useEffect, useRef, useState } from "react";
const slides = [
  {
    title: "One launch. Or skip.",
    lines: [
      "Choose an OG from the daily shortlist.",
      "One changeable vote. 10X makes the final selection or skips.",
    ],
  },
  {
    title: "Two prices. One position.",
    lines: [
      "OG is the original token. ATTN is the new token paired with it.",
      "Both prices affect your USD return. Gains and losses can be amplified. Trading is optional.",
    ],
  },
  {
    title: "Vote. Follow. Claim.",
    lines: [
      "Connect Farcaster and verify a Solana reward wallet. Warplet boosts are optional.",
      "The final top 100 earn allocations. Ten daily releases start 24 hours after the actual launch.",
      "Verified trading ranks are public. Sharing earns no reward.",
    ],
  },
];
export default function GuideDialog({
  onDone,
  opener,
}: {
  onDone: () => void;
  opener: HTMLElement | null;
}) {
  const [step, setStep] = useState(0),
    dialog = useRef<HTMLDialogElement>(null),
    body = useRef<HTMLDivElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    returnFocus = useRef<HTMLElement | null>(opener);
  useEffect(() => {
    if (!dialog.current?.open) {
      dialog.current?.showModal();
    }
    heading.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (body.current) body.current.scrollTop = 0;
    heading.current?.focus({ preventScroll: true });
  }, [step]);
  const slide = slides[step];
  return (
    <dialog
      ref={dialog}
      className="onboarding guide-dialog"
      aria-label="How 10X works"
      onClose={() => {
        onDone();
        requestAnimationFrame(() => {
          if (returnFocus.current?.isConnected)
            returnFocus.current.focus({ preventScroll: true });
        });
      }}
    >
      <header className="modal-heading">
        <h2 ref={heading} tabIndex={-1}>
          {slide.title}
        </h2>
        <button
          className="icon-button"
          aria-label="Close guide"
          onClick={() => dialog.current?.close()}
        >
          ×
        </button>
      </header>
      <div
        ref={body}
        className="guide-body"
        role="region"
        aria-label="Guide details"
        tabIndex={0}
      >
        {step === 0 ? (
          <div className="guide-choices" aria-hidden="true">
            <span>OG</span>
            <span className="guide-choice">OG</span>
            <span>OG</span>
            <strong>One daily pick</strong>
          </div>
        ) : step === 1 ? (
          <>
            <div className="chart-legend">
              <span>
                <i className="legend-attn" />
                ATTN
              </span>
              <span>
                <i className="legend-og" />
                OG
              </span>
              <span>Illustration</span>
            </div>
            <svg
              viewBox="0 0 320 110"
              role="img"
              aria-label="Illustrative paths show both gains and losses"
              className="guide-chart"
            >
              <path d="M8 55h304" stroke="#00ff0035" strokeDasharray="4 4" />
              <path
                d="M8 55L70 44L140 50L210 34L312 20"
                stroke="#a798ff"
                fill="none"
                strokeWidth="3"
              />
              <path
                d="M8 55L70 15L140 62L210 30L312 94"
                stroke="#00ff00"
                fill="none"
                strokeWidth="3"
              />
            </svg>
          </>
        ) : (
          <div className="guide-release" aria-hidden="true">
            <strong>+24h</strong>
            <span>First release after launch</span>
            <div>
              {Array.from({ length: 10 }, (_, i) => (
                <i key={i} />
              ))}
            </div>
            <span>10 daily releases</span>
          </div>
        )}
        {slide.lines.map((line) => (
          <p className="guide-info" key={line}>
            {line}
          </p>
        ))}
        <p className="fine guide-preview">
          Preview · launches and claims are disabled.
        </p>
      </div>
      <footer className="guide-footer">
        <nav className="guide-dots" aria-label="Guide steps">
          {slides.map((s, i) => (
            <button
              key={s.title}
              aria-label={"Go to guide step " + (i + 1)}
              aria-current={i === step ? "step" : undefined}
              onClick={() => setStep(i)}
            >
              <span />
            </button>
          ))}
        </nav>
        <div className="guide-actions">
          {step > 0 && (
            <button className="secondary" onClick={() => setStep((n) => n - 1)}>
              Back
            </button>
          )}
          <button
            className="primary"
            onClick={() =>
              step === 2 ? dialog.current?.close() : setStep((n) => n + 1)
            }
          >
            {step === 2 ? "Got it" : "Next"}
          </button>
        </div>
      </footer>
    </dialog>
  );
}

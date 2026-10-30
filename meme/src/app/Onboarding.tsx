import { useState } from "react";
import {
  onboardingComplete,
  completeOnboarding,
} from "@10x/connect/miniAppContext";
export const onboardingKey = "10x:launchpad:onboarding:v1";
function storage() {
  try {
    return localStorage;
  } catch {
    return null;
  }
}
const steps = [
  {
    title: "One launch. Or skip.",
    text: "Vote for today’s OG. The operator makes the final selection.",
  },
  {
    title: "Two prices. One position.",
    text: "ATTN trades against its OG. Both prices affect your USD return.",
  },
  {
    title: "Vote. Follow. Claim.",
    text: "Voting earns points. Trading is optional. Verified trading ranks are public.",
  },
];
export default function Onboarding({
  replay,
  onDone,
}: {
  replay?: boolean;
  onDone?: () => void;
}) {
  const [visible, setVisible] = useState(
    () => replay || !onboardingComplete(storage(), onboardingKey),
  );
  const [step, setStep] = useState(0);
  function done() {
    completeOnboarding(storage(), onboardingKey);
    setVisible(false);
    onDone?.();
  }
  if (!visible) return null;
  return (
    <section className="card onboarding" aria-label="Getting started">
      <div className="list-heading">
        <span className="eyebrow">How it works · {step + 1}/3</span>
        <button className="text-button" onClick={done}>
          Skip
        </button>
      </div>
      <div aria-live="polite">
        <h2>{steps[step].title}</h2>
        <p>{steps[step].text}</p>
      </div>
      {step === 1 && (
        <>
          <svg
            viewBox="0 0 320 80"
            role="img"
            aria-label="Illustrative paths show both gains and losses"
            className="onboarding-chart"
          >
            <path
              d="M5 40 L75 32 L135 36 L205 25 L315 15"
              stroke="#00ff00"
              fill="none"
              strokeWidth="3"
            />
            <path
              d="M5 40 L75 14 L135 42 L205 22 L315 65"
              stroke="#c1b4ff"
              fill="none"
              strokeWidth="3"
            />
          </svg>
          <p className="fine">
            <span style={{color:"#00ff00"}}>OG</span> · <span style={{color:"#c1b4ff"}}>ATTN</span> · Illustration
          </p>
          <p className="fine">Gains and losses can be amplified.</p>
        </>
      )}
      <div className="onboarding-actions">
        {step > 0 && (
          <button onClick={() => setStep((s) => s - 1)}>Back</button>
        )}
        <button
          className="primary"
          onClick={() => (step === 2 ? done() : setStep((s) => s + 1))}
        >
          {step === 2 ? "Got it" : "Next"}
        </button>
      </div>
    </section>
  );
}

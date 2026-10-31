import { lazy, Suspense, useState, useRef } from "react";
import {
  onboardingComplete,
  completeOnboarding,
} from "@10x/connect/miniAppContext";
const GuideDialog = lazy(() => import("./GuideDialog"));
export const onboardingKey = "10x:launchpad:onboarding:v1";
let completedThisPage = false;
function storage() {
  try {
    return localStorage;
  } catch {
    return null;
  }
}
export default function Onboarding({
  replay,
  onDone,
  opener,
}: {
  replay?: boolean;
  onDone?: () => void;
  opener?: HTMLElement | null;
}) {
  const launcher = useRef<HTMLElement | null>(opener ?? null);
  const [visible, setVisible] = useState(
      () =>
        !!replay ||
        !(completedThisPage || onboardingComplete(storage(), onboardingKey)),
    ),
    [open, setOpen] = useState(!!replay);
  function done() {
    completedThisPage = true;
    completeOnboarding(storage(), onboardingKey);
    setVisible(false);
    setOpen(false);
    onDone?.();
  }
  if (!visible) return null;
  if (open)
    return (
      <Suspense
        fallback={
          <section className="card welcome-guide" aria-label="Getting started">
            <p role="status">Opening the guide…</p>
            <button onClick={done}>Cancel</button>
          </section>
        }
      >
        <GuideDialog onDone={done} opener={launcher.current} />
      </Suspense>
    );
  return (
    <section className="card welcome-guide" aria-label="Getting started">
      <div>
        <h2>New to 10X?</h2>
        <p>Connect. Vote. Follow the launch.</p>
      </div>
      <div className="welcome-guide-actions">
        <button
          className="secondary"
          onClick={(event) => {
            launcher.current = event.currentTarget;
            setOpen(true);
          }}
        >
          Quick tour
        </button>
        <button className="text-button" onClick={done}>
          Skip
        </button>
      </div>
    </section>
  );
}

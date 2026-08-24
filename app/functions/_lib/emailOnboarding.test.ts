import { describe, expect, it } from "vitest";
import { emailOnboardingEnabled, nextEmailOnboardingStep } from "./emailOnboarding.js";

describe("email onboarding controls", () => {
  it("is disabled unless explicitly enabled", () => {
    expect(emailOnboardingEnabled({ WARPLETS: {} as D1Database })).toBe(false);
    expect(emailOnboardingEnabled({ WARPLETS: {} as D1Database, RESEND_ONBOARDING_ENABLED: " true " })).toBe(true);
    expect(emailOnboardingEnabled({ WARPLETS: {} as D1Database, RESEND_ONBOARDING_ENABLED: "false" })).toBe(false);
  });

  it("resumes at the first undelivered email", () => {
    expect(nextEmailOnboardingStep(-1)).toBe(0);
    expect(nextEmailOnboardingStep(0)).toBe(1);
    expect(nextEmailOnboardingStep(6)).toBe(7);
    expect(nextEmailOnboardingStep(7)).toBeNull();
  });
});

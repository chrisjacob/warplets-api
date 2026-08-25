import { describe, expect, it } from "vitest";
import { canPresentAirdrop, shouldCoverAppWhileResolvingOnboarding, shouldOpenOnboarding } from "./searchModalSequence";

const readyState = {
  onboardingComplete: false,
  showOnboarding: false,
  miniAppContextKnown: true,
  isInMiniAppContext: true,
  viewerFid: 1129138,
  searchCompletionStatusLoaded: true,
  onboardingDecisionTimedOut: false,
};

describe("Search modal sequencing", () => {
  it("waits for server completion status before opening Mini App onboarding", () => {
    expect(shouldOpenOnboarding({ ...readyState, searchCompletionStatusLoaded: false })).toBe(false);
  });

  it("opens onboarding after status resolves when it remains incomplete", () => {
    expect(shouldOpenOnboarding(readyState)).toBe(true);
  });

  it("opens onboarding after the startup decision timeout", () => {
    expect(shouldOpenOnboarding({
      ...readyState,
      miniAppContextKnown: false,
      searchCompletionStatusLoaded: false,
      onboardingDecisionTimedOut: true,
    })).toBe(true);
  });

  it("does not reopen onboarding when the server says it is complete", () => {
    expect(shouldOpenOnboarding({ ...readyState, onboardingComplete: true })).toBe(false);
  });

  it("covers the app until locally-new onboarding is visible or confirmed complete", () => {
    expect(shouldCoverAppWhileResolvingOnboarding({
      ...readyState,
      miniAppContextKnown: false,
      searchCompletionStatusLoaded: false,
    })).toBe(true);
    expect(shouldCoverAppWhileResolvingOnboarding(readyState)).toBe(true);
    expect(shouldCoverAppWhileResolvingOnboarding({ ...readyState, showOnboarding: true })).toBe(false);
    expect(shouldCoverAppWhileResolvingOnboarding({ ...readyState, onboardingComplete: true })).toBe(false);
  });

  it("never presents the airdrop over onboarding", () => {
    expect(canPresentAirdrop(true)).toBe(false);
    expect(canPresentAirdrop(false)).toBe(true);
  });
});

export type OnboardingGateState = {
  onboardingComplete: boolean;
  showOnboarding: boolean;
  miniAppContextKnown: boolean;
  isInMiniAppContext: boolean;
  viewerFid: number | null;
  searchCompletionStatusLoaded: boolean;
  onboardingDecisionTimedOut: boolean;
};

export function shouldOpenOnboarding(state: OnboardingGateState): boolean {
  if (state.onboardingComplete || state.showOnboarding) return false;
  if (state.onboardingDecisionTimedOut) return true;
  if (!state.miniAppContextKnown) return false;
  if (state.isInMiniAppContext && state.viewerFid != null && !state.searchCompletionStatusLoaded) return false;
  return true;
}

export function shouldCoverAppWhileResolvingOnboarding(state: OnboardingGateState): boolean {
  return !state.onboardingComplete && !state.showOnboarding;
}

export function canPresentAirdrop(showOnboarding: boolean): boolean {
  return !showOnboarding;
}

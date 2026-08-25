export type OnboardingGateState = {
  onboardingComplete: boolean;
  showOnboarding: boolean;
  miniAppContextKnown: boolean;
  isInMiniAppContext: boolean;
  viewerFid: number | null;
  searchCompletionStatusLoaded: boolean;
};

export function shouldOpenOnboarding(state: OnboardingGateState): boolean {
  if (state.onboardingComplete || state.showOnboarding || !state.miniAppContextKnown) return false;
  if (state.isInMiniAppContext && state.viewerFid != null && !state.searchCompletionStatusLoaded) return false;
  return true;
}

export function canPresentAirdrop(showOnboarding: boolean): boolean {
  return !showOnboarding;
}

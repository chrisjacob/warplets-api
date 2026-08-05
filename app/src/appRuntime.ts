export type AppSurface = "farcaster-miniapp" | "web";

export interface AppCapabilities {
  surface: AppSurface;
  embeddedWallet: boolean;
  farcasterIdentity: boolean;
  farcasterNotifications: boolean;
  haptics: boolean;
  composeCast: boolean;
  webShare: boolean;
}

export function resolveAppSurface(isInMiniApp: boolean): AppSurface {
  return isInMiniApp ? "farcaster-miniapp" : "web";
}

export function resolveAppCapabilities(surface: AppSurface, navigatorLike?: Pick<Navigator, "share">): AppCapabilities {
  const farcaster = surface === "farcaster-miniapp";
  return {
    surface,
    embeddedWallet: farcaster,
    farcasterIdentity: farcaster,
    farcasterNotifications: farcaster,
    haptics: farcaster,
    composeCast: farcaster,
    webShare: !farcaster && typeof navigatorLike?.share === "function",
  };
}

import sdk from "@farcaster/miniapp-sdk";
import type { AppSurface } from "./appRuntime";
import type { EthereumProvider } from "./walletTrade";

let surface: AppSurface = "web";

export const FARCASTER_NOTIFICATIONS_MANUAL_ENABLE_MESSAGE =
  "This app is installed, but notifications are disabled. Open its settings in Farcaster and manually enable notifications.";

export function configureAppSurface(next: AppSurface): void {
  surface = next;
}

export function currentAppSurface(): AppSurface {
  return surface;
}

export async function signalAppReady(): Promise<void> {
  if (surface === "farcaster-miniapp") await sdk.actions.ready();
}

export async function getEmbeddedWalletProvider(): Promise<EthereumProvider | null> {
  if (surface !== "farcaster-miniapp") return null;
  return await sdk.wallet.getEthereumProvider() as EthereumProvider | null;
}

export async function openAppUrl(url: string): Promise<void> {
  if (surface === "farcaster-miniapp") {
    await sdk.actions.openUrl(url);
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export async function viewFarcasterProfile(fid: number): Promise<void> {
  if (surface === "farcaster-miniapp") {
    await sdk.actions.viewProfile({ fid });
    return;
  }
  await openAppUrl(`https://farcaster.xyz/~/profiles/${fid}`);
}

export async function composeFarcasterPost(text: string, embeds: string[] = []): Promise<void> {
  if (surface === "farcaster-miniapp") {
    const limitedEmbeds = embeds.slice(0, 2) as [] | [string] | [string, string];
    await sdk.actions.composeCast({ text, embeds: limitedEmbeds });
    return;
  }
  const params = new URLSearchParams({ text });
  for (const embed of embeds) params.append("embeds[]", embed);
  await openAppUrl(`https://farcaster.xyz/~/compose?${params.toString()}`);
}

export async function requestFarcasterNotifications() {
  if (surface !== "farcaster-miniapp") throw new Error("Enable Base notifications from the app settings in Base App");
  return await sdk.actions.addMiniApp();
}

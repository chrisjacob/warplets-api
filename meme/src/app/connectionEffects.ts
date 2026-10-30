import { hapticSuccess } from "@10x/connect/host";
import type { Options } from "canvas-confetti";

type HapticClient = {
  isInMiniApp(): Promise<boolean>;
  getCapabilities(): Promise<readonly string[]>;
  haptics: { notificationOccurred(type: "success"): Promise<void> };
};
/** Same capability-checked success notification used by the other 10X apps.
 * Standalone Safari never loads the bridge or attempts device vibration. */
export async function miniAppSuccess(
  load: () => Promise<HapticClient> = async () =>
    (await import("@farcaster/miniapp-sdk")).default,
  embedded = typeof window !== "undefined" &&
    (window.parent !== window || "ReactNativeWebView" in window),
) {
  if (!embedded) return;
  try {
    const sdk = await load();
    if (!(await sdk.isInMiniApp())) return;
    if ((await sdk.getCapabilities()).includes("haptics.notificationOccurred"))
      await sdk.haptics.notificationOccurred("success");
  } catch {
    /* Optional feedback must never interrupt authentication. */
  }
}

type Effects = {
  reducedMotion: () => boolean;
  loadConfetti: () => Promise<(options: Options) => unknown>;
  haptic: () => Promise<void>;
};
/** Reuse the existing 10X confetti palette/settings, loaded only after verified success. */
export async function connectionSuccessEffects(
  effects: Effects = {
    reducedMotion: () =>
      typeof window === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    loadConfetti: async () => (await import("canvas-confetti")).default,
    haptic: hapticSuccess,
  },
) {
  await Promise.allSettled([
    (async () => {
      if (effects.reducedMotion()) return;
      const confetti = await effects.loadConfetti();
      await confetti({
        particleCount: 120,
        spread: 70,
        origin: { y: 0.72 },
        colors: ["#00FF00", "#FFFFFF", "#FFFF00"],
        zIndex: 2401,
        disableForReducedMotion: true,
      });
    })(),
    (async () => effects.haptic())(),
  ]);
}

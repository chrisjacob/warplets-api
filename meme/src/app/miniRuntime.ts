import { detectMiniAppContext } from "@10x/connect/miniAppContext";
import { decode58, encode58 } from "../shared/base58";
import { qaEnabled } from "./qaMode";

export interface NativeMessageProvider {
  request(input: { method: "connect" }): Promise<{ publicKey: string }>;
  signMessage(message: string): Promise<{ signature: string }>;
}
export function nativeSignature(value: string) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(value))
    throw Error("Invalid wallet signature");
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  if (bytes.length !== 64 || btoa(String.fromCharCode(...bytes)) !== value)
    throw Error("Invalid wallet signature");
  return encode58(bytes);
}
export async function nativeAccount(provider: NativeMessageProvider) {
  const result = await provider.request({ method: "connect" });
  decode58(result.publicKey, 32);
  return result.publicKey;
}
type Runtime = {
  sdk: typeof import("@farcaster/miniapp-sdk").default;
  capabilities: readonly string[];
};
let pending: Promise<Runtime | null> | undefined;
async function bounded<T>(promise: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.catch(() => fallback),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
/** No RPC, identity assertion, wallet prompt or permission request at startup. */
export function miniRuntime(): Promise<Runtime | null> {
  if (qaEnabled) return Promise.resolve(null);
  return (pending ??= (async () => {
    if (
      typeof window === "undefined" ||
      (window.parent === window && !("ReactNativeWebView" in window))
    )
      return null;
    const sdk = (await import("@farcaster/miniapp-sdk")).default;
    if (!(await detectMiniAppContext(() => sdk.isInMiniApp()))) return null;
    await bounded(sdk.actions.ready(), undefined);
    const capabilities = await bounded<readonly string[]>(
      sdk.getCapabilities(),
      [],
    );
    const context = await bounded(sdk.context, null);
    const insets = context?.client.safeAreaInsets;
    for (const side of ["top", "bottom"] as const) {
      const value = insets?.[side];
      if (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 200
      )
        document.documentElement.style.setProperty(
          "--mini-safe-" + side,
          value + "px",
        );
    }
    return { sdk, capabilities };
  })().catch(() => null));
}

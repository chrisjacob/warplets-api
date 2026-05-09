import sdk from "@farcaster/miniapp-sdk";

type Capability =
  | "haptics.impactOccurred"
  | "haptics.notificationOccurred"
  | "haptics.selectionChanged";

let cachedCapabilities: Set<string> | null = null;
let capabilityPromise: Promise<Set<string>> | null = null;

async function getCapabilitySet(): Promise<Set<string>> {
  if (cachedCapabilities) return cachedCapabilities;
  if (!capabilityPromise) {
    capabilityPromise = (async () => {
      try {
        const capabilities = await sdk.getCapabilities();
        const set = new Set<string>(Array.isArray(capabilities) ? capabilities : []);
        cachedCapabilities = set;
        return set;
      } catch {
        const fallback = new Set<string>();
        cachedCapabilities = fallback;
        return fallback;
      }
    })();
  }
  return capabilityPromise;
}

async function withCapability(capability: Capability, run: () => Promise<void>): Promise<void> {
  try {
    const capabilities = await getCapabilitySet();
    if (!capabilities.has(capability)) return;
    await run();
  } catch {
    // Never fail app flow on haptics issues.
  }
}

export async function hapticTap(): Promise<void> {
  await withCapability("haptics.impactOccurred", () => sdk.haptics.impactOccurred("light"));
}

export async function hapticPrimaryTap(): Promise<void> {
  await withCapability("haptics.impactOccurred", () => sdk.haptics.impactOccurred("medium"));
}

export async function hapticStrongTap(): Promise<void> {
  await withCapability("haptics.impactOccurred", () => sdk.haptics.impactOccurred("heavy"));
}

export async function hapticSuccess(): Promise<void> {
  await withCapability("haptics.notificationOccurred", () => sdk.haptics.notificationOccurred("success"));
}

export async function hapticWarning(): Promise<void> {
  await withCapability("haptics.notificationOccurred", () => sdk.haptics.notificationOccurred("warning"));
}

export async function hapticError(): Promise<void> {
  await withCapability("haptics.notificationOccurred", () => sdk.haptics.notificationOccurred("error"));
}

export async function hapticSelectionChanged(): Promise<void> {
  await withCapability("haptics.selectionChanged", () => sdk.haptics.selectionChanged());
}

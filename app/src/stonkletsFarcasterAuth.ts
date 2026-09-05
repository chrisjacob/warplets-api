import sdk from "@farcaster/miniapp-sdk";
import { loadAppSession, verifyFarcasterQuickAuth } from "./appSession";

// Startup and the first vote must share the same verified sign-in operation.
let pending: ReturnType<typeof authenticate> | null = null;
async function authenticate() {
  const { token } = await sdk.quickAuth.getToken();
  const verified = await verifyFarcasterQuickAuth(token);
  const fid = Number(verified.farcasterFid);
  if (!Number.isInteger(fid) || fid <= 0) throw new Error("Farcaster identity could not be verified. Please try again.");
  // Warplets uses this shared user sync to populate the primary address used
  // by the server's favourite identity resolver. No wallet connection is needed.
  const response = await fetch("/api/warplet-status", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fid, appSlug: "warplets" }),
  });
  if (!response.ok) throw new Error("Couldn't load your Farcaster account. Please try again.");
  const session = await loadAppSession();
  if (!session.authenticated || session.farcasterFid !== fid) throw new Error("Couldn't restore your Farcaster session. Please try again.");
  return session;
}

export function authenticateStonkletsFarcaster() {
  if (!pending) pending = authenticate().finally(() => { pending = null; });
  return pending;
}

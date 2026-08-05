export interface IdentityProfile {
  fid: number;
  username: string | null;
  displayName: string | null;
  pfpUrl: string | null;
}

export interface AppIdentity {
  farcaster: { fid: number; profile: IdentityProfile; verified: boolean } | null;
  wallet: { address: `0x${string}`; verified: boolean } | null;
}

export const ANONYMOUS_APP_IDENTITY: AppIdentity = { farcaster: null, wallet: null };

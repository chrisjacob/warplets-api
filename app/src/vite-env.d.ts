interface ImportMetaEnv {
  readonly VITE_X_AUTH_ENABLED?: string;
  readonly DEV: boolean;
  readonly VITE_WEB_WALLET_ENABLED?: string;
  readonly VITE_TRUSTCONNECT_ENABLED?: string;
  readonly VITE_BASE_ACCOUNT_ENABLED?: string;
  readonly VITE_BASE_BUILDER_CODE?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
  readonly VITE_FARCASTER_WARPLETS_MINI_APP_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

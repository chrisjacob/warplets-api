// Vite replaces these at build time. An ordinary production build stays closed;
// local development remains available unless explicitly disabled.
export const TENX_APP_ENABLED = import.meta.env.VITE_TENX_APP_ENABLED === "true"
  || (import.meta.env.DEV && import.meta.env.VITE_TENX_APP_ENABLED !== "false");

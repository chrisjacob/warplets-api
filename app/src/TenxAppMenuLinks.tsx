import { TENX_APP_ENABLED } from "./tenxRelease";

export function TenxAppMenuLinks({ onNavigate, walletHref = "/wallets", enabled = TENX_APP_ENABLED }: { onNavigate: () => void; walletHref?: string; enabled?: boolean }) {
  return <>
    {enabled && <a href="/discover" role="menuitem" onClick={onNavigate}>Discover Solana</a>}
    <a href={enabled ? "/thesis" : "/"} role="menuitem" onClick={onNavigate}>The 10X Thesis</a>
    {enabled && <a href={walletHref} role="menuitem" onClick={onNavigate}>Solana sign-in & wallets</a>}
  </>;
}

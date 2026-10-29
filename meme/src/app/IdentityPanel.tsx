import { lazy, Suspense, useState, useEffect } from "react";
import type { Identity } from "./client";
const ConnectDialog = lazy(() => import("./ConnectDialog"));
export function IdentityPanel({
  identity,
  onIdentity,
  open,
  onOpenChange,
}: {
  identity: Identity | null;
  onIdentity: (identity: Identity) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const requested = loaded || open;
  useEffect(() => {
    if (open) setLoaded(true);
  }, [open]);
  return (
    <div className="identity-controls">
      <button onClick={() => onOpenChange(true)}>
        {identity?.farcasterFid
          ? "Account · " + identity.farcasterFid
          : "Connect"}
      </button>
      {requested && (
        <Suspense
          fallback={open ? <span role="status">Opening Connect…</span> : null}
        >
          <ConnectDialog
            open={open}
            onClose={() => onOpenChange(false)}
            identity={identity}
            onIdentity={onIdentity}
          />
        </Suspense>
      )}
    </div>
  );
}

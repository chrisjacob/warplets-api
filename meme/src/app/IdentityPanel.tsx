import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";
import type { Identity } from "./client";
const ConnectDialog = lazy(() => import("./ConnectDialog"));
class ConnectBoundary extends Component<
  { children: ReactNode; open: boolean; onClose: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      this.props.open ? (
        <div className="connect-feedback" role="alert">
          <span>Couldn’t open Connect.</span>
          <button onClick={() => location.reload()}>Reload</button>
          <button onClick={this.props.onClose}>Close</button>
        </div>
      ) : null
    ) : (
      this.props.children
    );
  }
}
function OpeningConnect({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <div className="connect-feedback" role="status">
      <span>Opening Connect…</span>
      <button onClick={onClose}>Cancel</button>
    </div>
  );
}
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
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    onOpenChange(false);
    trigger.current?.focus();
  };
  return (
    <div className="identity-controls">
      <button ref={trigger} onClick={() => onOpenChange(true)}>
        {identity?.farcasterFid
          ? "Account · " + identity.farcasterFid
          : "Connect"}
      </button>
      {(loaded || open) && (
        <ConnectBoundary open={open} onClose={close}>
          <Suspense
            fallback={
              open ? (
                <OpeningConnect onClose={() => onOpenChange(false)} />
              ) : null
            }
          >
            <ConnectDialog
              open={open}
              onClose={() => onOpenChange(false)}
              onReady={() => setLoaded(true)}
              identity={identity}
              onIdentity={onIdentity}
            />
          </Suspense>
        </ConnectBoundary>
      )}
    </div>
  );
}

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useOverlayScrollbars } from "overlayscrollbars-react";
import { AppViewport } from "./AppViewport";
import { hapticSelectionChanged, hapticTap } from "./haptics";
import type { AppSessionState } from "./appSession";

export function SocialIcon({
  name,
}: {
  name:
    | "like"
    | "comment"
    | "quote"
    | "recast"
    | "share"
    | "search"
    | "close"
    | "chevron"
    | "write"
    | "external"
    | "wallet"
    | "user"
    | "more";
}) {
  const paths = {
    like: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
    comment:
      "M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7A8.4 8.4 0 0 1 4 11.5a8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z",
    quote: "M4 6h6v7H4V6Zm10 0h6v7h-6V6ZM10 13c0 4-2 5-4 5m14-5c0 4-2 5-4 5",
    recast:
      "m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-1v3a2 2 0 0 1-2 2H3",
    share: "M12 16V3m-5 5 5-5 5 5M5 13v7h14v-7",
    search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
    close: "m6 6 12 12M6 18 18 6",
    chevron: "m6 9 6 6 6-6",
    write: "m16 3 5 5-12 12H4v-5L16 3ZM14 5l5 5",
    more: "M5 12h.01M12 12h.01M19 12h.01",
    external:
      "M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5",
    wallet: "M20 7H4V4h14v3M4 7v13h17V7H4Zm17 5h-6v4h6",
    user: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2",
  };
  return (
    <svg
      className="social-icon"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "more" ? 4 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}

export function SocialModal({
  title,
  children,
  footer,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const id = useId(),
    panel = useRef<HTMLDivElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    body = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [initialize] = useOverlayScrollbars({
    options: {
      scrollbars: {
        theme: "os-theme-10x",
        autoHide: "scroll",
        clickScroll: true,
      },
    },
    defer: true,
  });
  useEffect(() => {
    if (body.current) initialize(body.current);
  }, [initialize]);
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    heading.current?.focus();
    const contain = (event: FocusEvent) => {
      if (!panel.current?.contains(event.target as Node))
        heading.current?.focus();
    };
    document.addEventListener("focusin", contain);
    // A focused control can become disabled (e.g. the last gallery image),
    // returning focus to the body. Escape must still close the active dialog.
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      }
    };
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("focusin", contain);
      document.removeEventListener("keydown", escape, true);
      document.body.style.overflow = overflow;
      requestAnimationFrame(() => {
        if (previous?.isConnected) previous.focus({ preventScroll: true });
        else
          document
            .querySelector<HTMLElement>(
              ".social-compose-prompt, .social-main button",
            )
            ?.focus({ preventScroll: true });
      });
    };
  }, []);
  return (
    <AppViewport
      className="app-modal-viewport social-dialog-viewport fixed inset-0 z-[210] flex items-end justify-center bg-black/80 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-busy={busy}
      aria-labelledby={id}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          close.current();
        }
        if (e.key !== "Tab") return;
        const elements = [
          ...panel.current!.querySelectorAll<HTMLElement>(
            "button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary",
          ),
        ].filter((el) => el.getClientRects().length);
        const first = elements[0],
          last = elements.at(-1);
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === heading.current)
        ) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }}
    >
      <div
        ref={panel}
        className="app-modal-panel social-dialog flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[#00FF00]/35 bg-black shadow-2xl"
      >
        <header className="app-modal-header social-dialog-header">
          <h2 ref={heading} id={id} tabIndex={-1}>
            {title}
          </h2>
          <button
            className="social-icon-button"
            aria-label="Close"
            onClick={onClose}
          >
            <SocialIcon name="close" />
          </button>
        </header>
        <div
          ref={body}
          className="app-modal-scroll-body min-h-0 flex-1 overflow-y-auto p-4"
        >
          <div>{children}</div>
        </div>
        {footer && (
          <footer className="app-modal-footer social-dialog-footer">
            {footer}
          </footer>
        )}
      </div>
    </AppViewport>
  );
}

export function SocialDropdown({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div
      className="social-dropdown"
      ref={root}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          if (!open) {
            setOpen(true);
            return;
          }
          const items = [
            ...root.current!.querySelectorAll<HTMLElement>('[role="option"]'),
          ];
          const current = items.indexOf(document.activeElement as HTMLElement);
          const next =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? items.length - 1
                : (current + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
                  items.length;
          items[next]?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="social-dropdown-trigger"
        aria-label={`${label}: ${options.find((o) => o.value === value)?.label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          void hapticTap();
          setOpen(!open);
        }}
      >
        {options.find((o) => o.value === value)?.label}
        <SocialIcon name="chevron" />
      </button>
      {open && (
        <div
          id={id}
          role="listbox"
          aria-label={label}
          className="social-dropdown-options"
        >
          <span>{label}</span>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={value === option.value}
              onClick={() => {
                void hapticSelectionChanged();
                onChange(option.value);
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SocialReasonDialog({
  title,
  submitLabel = "Submit report",
  onClose,
  onSubmit,
}: {
  title: string;
  submitLabel?: string;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<unknown>;
}) {
  const [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <SocialModal
      title={title}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button className="social-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="social-primary"
            disabled={busy || reason.trim().length < 3}
            onClick={() => {
              setBusy(true);
              void onSubmit(reason.trim())
                .then(onClose)
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "Saving…" : submitLabel}
          </button>
        </>
      }
    >
      <label className="social-field">
        Reason
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          rows={4}
        />
      </label>
      {error && (
        <p className="social-notice social-error" role="alert">
          {error}
        </p>
      )}
    </SocialModal>
  );
}

function AccountImage({
  src,
  label,
  icon,
}: {
  src: string;
  label: string;
  icon: "wallet" | "user";
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return failed ? (
    <span className="social-account-fallback" role="img" aria-label={label}>
      <SocialIcon name={icon} />
    </span>
  ) : (
    <img
      className="search-header-avatar-image"
      src={src}
      alt={label}
      onError={() => setFailed(true)}
    />
  );
}

export function SocialAccount({
  session,
  mini,
  anchor,
  onAnchor,
  onConnect,
  onNavigate,
  onOnboard,
  onNotifications,
  onDisconnect,
}: {
  session: AppSessionState | null;
  mini: boolean;
  anchor: "title" | "avatar" | null;
  onAnchor: (value: "title" | "avatar" | null) => void;
  onConnect: () => void;
  onNavigate: (page: "rewards" | "about") => void;
  onOnboard: () => void;
  onNotifications: () => void;
  onDisconnect: () => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const profile = session?.farcasterProfile,
    wallet = session?.walletAddress,
    connected = session?.authenticated;
  useEffect(() => {
    if (!anchor) return;
    const outside = (e: PointerEvent) => {
      if (
        !root.current?.contains(e.target as Node) &&
        !menu.current?.contains(e.target as Node) &&
        !(e.target as Element).closest?.(".miniapp-header__title-badge")
      )
        onAnchor(null);
    };
    document.addEventListener("pointerdown", outside);
    menu.current?.querySelector("button")?.focus();
    return () => document.removeEventListener("pointerdown", outside);
  }, [anchor, onAnchor]);
  const choose = (fn: () => void) => {
    onAnchor(null);
    void hapticTap();
    fn();
  };
  const avatar = profile?.pfpUrl || "/farcaster.webp";
  return (
    <div className="search-header-account social-header-account" ref={root}>
      {!connected ? (
        <button className="search-header-connect-button" onClick={onConnect}>
          Connect
        </button>
      ) : (
        <button
          className="search-header-avatar-button"
          aria-label="Open account menu"
          aria-haspopup="menu"
          aria-expanded={!!anchor}
          onClick={() => onAnchor(anchor ? null : "avatar")}
        >
          <span className="search-header-avatar-stack">
            {wallet && !mini && (
              <span className="search-header-avatar-frame search-header-avatar-frame--wallet">
                <AccountImage src="/base.webp" label="Wallet" icon="wallet" />
              </span>
            )}
            {!!session?.farcasterFid && (
              <span className="search-header-avatar-frame search-header-avatar-frame--identity">
                <AccountImage src={avatar} label="Farcaster" icon="user" />
              </span>
            )}
          </span>
        </button>
      )}
      {anchor && (
        <AppViewport
          ref={menu}
          portalled={anchor === "title"}
          className={`search-header-account-menu${anchor === "title" ? " search-header-account-menu--centered" : ""}`}
          role="menu"
          onKeyDown={(e) => {
            const buttons = [
              ...menu.current!.querySelectorAll<HTMLButtonElement>("button"),
            ];
            const i = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            if (e.key === "Escape") {
              onAnchor(null);
              root.current?.querySelector("button")?.focus();
            }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              buttons[
                (i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                  buttons.length
              ]?.focus();
            }
            if (e.key === "Tab") onAnchor(null);
          }}
        >
          <button role="menuitem" onClick={() => choose(onConnect)}>
            {wallet
              ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}`
              : "Connect wallet"}
          </button>
          <button role="menuitem" onClick={() => choose(onConnect)}>
            {profile?.username ? `@${profile.username}` : "Connect Farcaster"}
          </button>
          <button
            role="menuitem"
            onClick={() => choose(() => onNavigate("rewards"))}
          >
            Rewards
          </button>
          <button
            role="menuitem"
            onClick={() => choose(() => onNavigate("about"))}
          >
            About Social
          </button>
          <button role="menuitem" onClick={() => choose(onOnboard)}>
            View onboarding
          </button>
          <button role="menuitem" onClick={() => choose(onNotifications)}>
            Enable notifications
          </button>
          {connected && !mini && (
            <button role="menuitem" onClick={() => choose(onDisconnect)}>
              Disconnect
            </button>
          )}
        </AppViewport>
      )}
    </div>
  );
}

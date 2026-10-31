import { useRef, useState, useEffect, type ReactNode } from "react";

/** Small chrome using the existing 10X assets; wallet/auth behavior stays in Connect. */
export function AppHeader({
  account,
  onHelp,
}: {
  account: ReactNode;
  onHelp: () => void;
}) {
  const [open, setOpen] = useState(false),
    dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    helpAfterClose = useRef(false);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    else if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  function close() {
    dialog.current?.close();
  }
  return (
    <>
      <header className="app-header">
        <a
          className="brand"
          href="https://app.10x.meme/"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="10X.MEME home"
        >
          <img src="/icon.png" alt="10X" width="56" height="56" />
        </a>
        <span className="app-title">10X.MEME</span>
        <div className="header-actions">
          {account}
          <button
            ref={trigger}
            className="icon-button menu-trigger"
            aria-label="Open menu"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </header>
      <dialog
        ref={dialog}
        className="app-menu"
        aria-labelledby="app-menu-title"
        onClose={() => {
          setOpen(false);
          if (helpAfterClose.current) {
            helpAfterClose.current = false;
            onHelp();
          } else trigger.current?.focus();
        }}
        onClick={(event) => {
          if (event.target === dialog.current) {
            const box = dialog.current.getBoundingClientRect();
            if (
              event.clientX < box.left ||
              event.clientX > box.right ||
              event.clientY < box.top ||
              event.clientY > box.bottom
            )
              close();
          }
        }}
      >
        <div className="list-heading">
          <h2 id="app-menu-title">Explore 10X</h2>
          <button
            className="icon-button"
            aria-label="Close menu"
            onClick={close}
          >
            ×
          </button>
        </div>
        <button
          className="menu-row"
          onClick={() => {
            helpAfterClose.current = true;
            close();
          }}
        >
          How it works <span aria-hidden="true">→</span>
        </button>
        <a
          className="menu-row"
          href="https://warplet.10x.meme/"
          target="_blank"
          rel="noopener noreferrer"
        >
          10X Warplets <span aria-hidden="true">↗</span>
        </a>
        <a
          className="menu-row"
          href="https://stonklet.10x.meme/"
          target="_blank"
          rel="noopener noreferrer"
        >
          10X Stonklets <span aria-hidden="true">↗</span>
        </a>
        <a
          className="menu-row"
          href="https://app.10x.meme/"
          target="_blank"
          rel="noopener noreferrer"
        >
          The 10X Thesis <span aria-hidden="true">↗</span>
        </a>
        <div className="menu-legal">
          <a
            href="https://app.10x.meme/terms"
            target="_blank"
            rel="noopener noreferrer"
          >
            Terms
          </a>
          <a
            href="https://app.10x.meme/privacy"
            target="_blank"
            rel="noopener noreferrer"
          >
            Privacy
          </a>
        </div>
      </dialog>
    </>
  );
}

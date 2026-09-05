import { AppViewport } from "./AppViewport";
import { useEffect, useRef, useState } from "react";

export const BSTOCKS_NOTICE_FORCE_PARAM = "bstocksNotice";
export const BSTOCKS_NOTICE_STORAGE_KEY = "10x:stonklets:bstocks-notice:v1";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

export function isBstocksNoticeForced(search: string): boolean {
  const value = new URLSearchParams(search).get(BSTOCKS_NOTICE_FORCE_PARAM)?.trim().toLowerCase();
  return value === "1" || value === "true";
}

export function hasAcceptedBstocksNotice(storage: ReadableStorage): boolean {
  try {
    return storage.getItem(BSTOCKS_NOTICE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberBstocksNoticeAcceptance(storage: WritableStorage): void {
  try {
    storage.setItem(BSTOCKS_NOTICE_STORAGE_KEY, "1");
  } catch {
    // The visitor may still continue when private browsing blocks persistence.
  }
}

export default function BstocksNoticeModal({ onAccept }: { onAccept: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const checkboxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    checkboxRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const accept = () => {
    if (!confirmed) return;
    rememberBstocksNoticeAcceptance(window.localStorage);
    onAccept();
  };

  return (
    <AppViewport
      className="app-modal-viewport fixed inset-0 z-[200] flex items-end justify-center bg-black/80 p-4 sm:items-center"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="bstocks-notice-title"
      aria-describedby="bstocks-notice-copy bstocks-notice-confirmation"
      onKeyDown={(event) => {
        if (event.key === "Escape") event.preventDefault();
      }}
    >
      <section className="app-modal-panel flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[#00FF00]/35 bg-black shadow-2xl">
        <header className="app-modal-header border-b border-[#00FF00]/20 bg-black px-4 py-3">
          <h1 id="bstocks-notice-title" className="min-w-0 truncate text-base font-bold text-[#8bbf8b]">
            <span className="text-[#00FF00]">bSTOCKS</span> Important Notice
          </h1>
        </header>

        <div className="app-modal-scroll-body min-h-0 overflow-y-auto p-4">
          <div id="bstocks-notice-copy" className="space-y-3 text-sm font-medium leading-relaxed text-[#8bbf8b]">
            <p className="rounded-lg border border-[#00FF00]/15 bg-[#041204] px-3 py-3">
              bStocks are tokenized securities issued by BTECH Holdings Ltd (ADGM). The information presented here is for informational purposes only and does not constitute an offer, solicitation, or investment advice. bStocks are not intended for distribution in the United States, to any US Person, or in any other restricted jurisdiction. Investing involves risk — the value of your investment may go down and you may not get back the amount invested. For full risk disclosures, legal documentation, and a list of restricted jurisdictions, please visit{" "}
              <a className="break-words font-bold text-[#00FF00] underline decoration-[#00FF00]/45 underline-offset-2 hover:text-white" href="https://bstocks.finance/en/prospectus" target="_blank" rel="noreferrer">bstocks.finance/en/prospectus</a>.
            </p>
            <p id="bstocks-notice-confirmation" className="rounded-lg border border-[#00FF00]/15 bg-[#041204] px-3 py-3">
              By proceeding, you confirm you are not a Restricted Person and that accessing this product is lawful in your jurisdiction.
            </p>
          </div>

          <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-lg border border-[#00FF00]/15 bg-[#041204] px-3 py-3 text-sm font-bold text-white">
            <input
              ref={checkboxRef}
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="h-4 w-4 shrink-0 cursor-pointer appearance-none border border-[#00FF00]/60 bg-black checked:border-[#00FF00] checked:bg-[#00FF00] checked:shadow-[inset_0_0_0_3px_#001000] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#00FF00]"
            />
            <span>I understand and confirm</span>
          </label>
        </div>

        <footer className="app-modal-footer border-t border-[#00FF00]/20 bg-black p-4">
          <button
            type="button"
            disabled={!confirmed}
            onClick={accept}
            className="w-full rounded-[20px] border border-[#009900] bg-[#00FF00] px-4 py-3 text-sm font-bold text-[rgb(0,80,0)] shadow-[3px_6px_0_#008000] transition-all duration-100 enabled:cursor-pointer enabled:hover:bg-[#33ff33] enabled:active:translate-x-[1px] enabled:active:translate-y-[3px] enabled:active:shadow-[1px_3px_0_#008000] disabled:cursor-not-allowed disabled:border-[#005c00] disabled:bg-[#004100] disabled:text-[#001800] disabled:opacity-70 disabled:shadow-none"
          >
            Continue
          </button>
        </footer>
      </section>
    </AppViewport>
  );
}

import { useEffect, useRef, useState, type ReactNode } from "react";

// Old shared links still reveal the collection panel before attempting to scroll.
export function isCollectionAnchor(hash: string) {
  return ["#coverage", "#wallet-coverage-plan"].includes(hash);
}

export function CollectionDetails({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(() => typeof window !== "undefined" && isCollectionAnchor(window.location.hash));
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const reveal = () => { if (isCollectionAnchor(window.location.hash)) setOpen(true); };
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, []);
  useEffect(() => {
    if (!open || !isCollectionAnchor(window.location.hash)) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(window.location.hash.slice(1));
      (target ?? details.current)?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);
  return <details id="coverage" ref={details} className="tenx-collection-details" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Data & collection details</summary>
    {open && children}
  </details>;
}

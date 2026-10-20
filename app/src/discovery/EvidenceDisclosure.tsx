import { useEffect, useRef, type ReactNode } from "react";

export function revealEvidenceTarget(details: HTMLDetailsElement, hash: string) {
  let id: string;
  try { id = decodeURIComponent(hash.replace(/^#/, "")); } catch { return null; }
  if (!id) return null;
  const target = details.ownerDocument.getElementById(id);
  if (!target || !details.contains(target)) return null;
  // Open nested evidence disclosures too, so direct proof links remain useful.
  for (let ancestor: Element | null = target; ancestor && details.contains(ancestor); ancestor = ancestor.parentElement) {
    if (ancestor.tagName === "DETAILS") (ancestor as HTMLDetailsElement).open = true;
  }
  details.open = true;
  return target;
}
export function EvidenceDisclosure({ id, title, summary, children }: { id: string; title: string; summary?: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    let frame: number | undefined;
    const reveal = () => {
      if (!ref.current) return;
      const target = revealEvidenceTarget(ref.current, window.location.hash);
      if (target) { if (frame !== undefined) window.cancelAnimationFrame(frame); frame = window.requestAnimationFrame(() => target.scrollIntoView({ block: "start" })); }
    };
    reveal(); window.addEventListener("hashchange", reveal);
    return () => { window.removeEventListener("hashchange", reveal); if (frame !== undefined) window.cancelAnimationFrame(frame); };
  }, []);
  return <details id={id} ref={ref} className="tenx-evidence-disclosure"><summary><span>{title}</span>{summary && <small>{summary}</small>}</summary><div className="tenx-evidence-body">{children}</div></details>;
}

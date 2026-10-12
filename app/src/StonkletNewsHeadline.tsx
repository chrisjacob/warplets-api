import { newsPublicationLabel } from "../shared/stonkletsNewsDates";
import { useLayoutEffect, useRef, useState } from "react";

export default function StonkletNewsHeadline({ headline, url, publishedAt, sector, evidence, expanded, onHover }: {
  headline: string; url?: string; publishedAt?: string; sector: boolean; evidence: string;
  expanded: boolean; onHover: (value: boolean) => void;
}) {
  const root = useRef<HTMLHeadingElement>(null);
  const [fitted, setFitted] = useState(headline);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const fit = () => {
      const style = getComputedStyle(element);
      if (element.clientWidth === 0) return;
      const content = element.querySelector("[data-news-content]");
      if (!content) return;
      const probe = content.cloneNode(true) as HTMLElement;
      // Measure in the same typography/scale context as the visible headline.
      // Only this fitter adds an ellipsis; the fixed-height heading never does.
      Object.assign(probe.style, { position: "absolute", visibility: "hidden", pointerEvents: "none", width: "100%", height: "auto", left: "0", top: "0" });
      probe.setAttribute("aria-hidden", "true");
      element.appendChild(probe);
      const limit = parseFloat(style.lineHeight) * 3 + 1;
      const fits = (text: string) => {
        probe.querySelector("[data-news-text]")!.textContent = text;
        return probe.scrollHeight <= limit;
      };
      try {
        if (fits(headline)) { setFitted(headline); return; }
        const chars = [...headline];
        const truncated = (length: number) => `${chars.slice(0, length).join("").replace(/[\s.\u2026]+$/u, "")}\u2026`;
        let low = 0, high = chars.length;
        while (low < high) { const mid = Math.ceil((low + high) / 2); if (fits(truncated(mid))) low = mid; else high = mid - 1; }
        setFitted(truncated(low));
      } finally { probe.remove(); }
    };
    fit();
    const observer = new ResizeObserver(fit); observer.observe(element);
    let disposed = false;
    void document.fonts.ready.then(() => { if (!disposed) fit(); });
    document.fonts.addEventListener("loadingdone", fit);
    return () => { disposed = true; observer.disconnect(); document.fonts.removeEventListener("loadingdone", fit); };
  }, [headline, url, publishedAt, sector, evidence, expanded]);
  return <h3 ref={root} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} className={`stonklets-news-headline-clamped ${expanded ? "text-lg" : "text-base"} font-black leading-snug text-white`}>
    <span data-news-content className="block"><a href={url} target="_blank" rel="noopener noreferrer" className="hover:text-[#00ff00]" title={headline} aria-label={`${headline} (opens in new tab)`}><span data-news-text>{fitted}</span></a>{publishedAt && <>{" "}<time className="stonklets-news-date" dateTime={publishedAt} title={`Published ${publishedAt.slice(0, 10)}`}>{newsPublicationLabel(publishedAt)}</time></>}{sector && <>{" "}<span className="stonklets-news-sector" title={evidence}>Market news</span></>}</span>
  </h3>;
}

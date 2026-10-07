import { newsPublicationLabel } from "../shared/stonkletsNewsDates";
import { useLayoutEffect, useRef, useState } from "react";

export default function StonkletNewsHeadline({ headline, url, publishedAt, attribution, sector, evidence, expanded, onHover }: {
  headline: string; url?: string; publishedAt?: string; attribution?: string; sector: boolean; evidence: string;
  expanded: boolean; onHover: (value: boolean) => void;
}) {
  const root = useRef<HTMLHeadingElement>(null);
  const [fitted, setFitted] = useState(headline);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const fit = () => {
      const style = getComputedStyle(element);
      const probe = element.cloneNode(true) as HTMLElement;
      Object.assign(probe.style, { position: "fixed", visibility: "hidden", pointerEvents: "none", width: style.width, height: "auto", display: "block", WebkitLineClamp: "unset", fontFamily: style.fontFamily, fontWeight: style.fontWeight, letterSpacing: style.letterSpacing, fontSize: style.fontSize, lineHeight: style.lineHeight });
      probe.removeAttribute("id"); probe.setAttribute("aria-hidden", "true");
      document.body.appendChild(probe);
      const limit = parseFloat(style.lineHeight) * 3 + 1;
      const fits = (text: string) => {
        const split = text.lastIndexOf(" ") + 1;
        probe.querySelector("[data-news-leading]")!.textContent = text.slice(0, split);
        probe.querySelector("[data-news-last]")!.textContent = text.slice(split);
        return probe.scrollHeight <= limit;
      };
      try {
        if (fits(headline)) { setFitted(headline); return; }
        const chars = [...headline];
        let low = 0, high = chars.length;
        while (low < high) { const mid = Math.ceil((low + high) / 2); if (fits(`${chars.slice(0, mid).join("").trimEnd()}…`)) low = mid; else high = mid - 1; }
        setFitted(`${chars.slice(0, low).join("").trimEnd()}…`);
      } finally { probe.remove(); }
    };
    fit();
    const observer = new ResizeObserver(fit); observer.observe(element);
    let disposed = false;
    void document.fonts.ready.then(() => { if (!disposed) fit(); });
    return () => { disposed = true; observer.disconnect(); };
  }, [headline, url, publishedAt, attribution, sector, evidence, expanded]);
  const split = fitted.lastIndexOf(" ") + 1;
  return <h3 ref={root} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} className={`stonklets-news-headline-clamped ${expanded ? "text-lg" : "text-base"} font-black leading-snug text-white`}>
    <a href={url} target="_blank" rel="noopener noreferrer" className="hover:text-[#00ff00]" title={headline} aria-label={`${headline} (opens in new tab)`}><span data-news-leading>{fitted.slice(0, split)}</span><span className="whitespace-nowrap"><span data-news-last>{fitted.slice(split)}</span></span></a>{publishedAt && <>{" "}<time className="stonklets-news-date" dateTime={publishedAt} title={`Published ${publishedAt.slice(0, 10)}`}>{newsPublicationLabel(publishedAt)}</time></>}{attribution && <>{" "}<a href={url} target="_blank" rel="noopener noreferrer" className="stonklets-news-attribution">{attribution}</a></>}{sector && <>{" "}<span className="stonklets-news-sector" title={evidence}>Sector narrative</span></>}
  </h3>;
}

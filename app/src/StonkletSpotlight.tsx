import StonkletNewsHeadline from "./StonkletNewsHeadline";
import { newsSource, type NewsItem } from "../shared/stonkletsNews";
import { useStonkletNews } from "./stonkletsNewsClient";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { STONKLETS_CATALOG, type StonkletCatalogEntry } from "../shared/stonkletsCatalog";


export default function StonkletSpotlight({ onShare, renderPair, renderIdentity, pairId }: {
  onShare: (entry: StonkletCatalogEntry, thesis: NewsItem) => void;
  pairId?: string;
  renderPair?: (pairId: string) => ReactNode;
  renderIdentity: (entry: StonkletCatalogEntry) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const chartsId = useId();
  const [titleHovered, setTitleHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const [nearby, setNearby] = useState(false);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [activeId, setActiveId] = useState<string | null>(() => new URLSearchParams(location.search).get("news"));
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const preload = new IntersectionObserver(entries => setNearby(entries.some(entry => entry.isIntersecting)), { rootMargin: "400px" });
    const viewport = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)));
    preload.observe(element); viewport.observe(element);
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const motion = () => setReduced(media.matches); media.addEventListener("change", motion);
    return () => { preload.disconnect(); viewport.disconnect(); media.removeEventListener("change", motion); };
  }, []);
  const stories = useStonkletNews(pairId, nearby);
  const storyIds = stories.map(story => story.id).join(",");
  useEffect(() => {
    const ids = storyIds ? storyIds.split(",") : [];
    if (ids.length < 2 || titleHovered || focusWithin || !visible || reduced) return;
    const interval = window.setInterval(() => {
      if (document.hidden || document.querySelector('[role="dialog"]')) return;
      setActiveId(current => ids[(Math.max(0, ids.indexOf(current ?? "")) + 1) % ids.length]!);
    }, 5000);
    return () => window.clearInterval(interval);
  }, [storyIds, titleHovered, focusWithin, activeId, visible, reduced]);
  const index = Math.max(0, stories.findIndex(item => item.id === activeId));
  const thesis = stories[index];
  const entry = thesis && STONKLETS_CATALOG.find(entry => entry.id === thesis.pairId);
  if (!thesis || !entry) return <div ref={root} className="stonklets-news-sentinel" />;
  const lead = newsSource(thesis);
  const headline = thesis.headline ?? lead?.title ?? "";
  const navigate = (next: number) => setActiveId(stories[(next + stories.length) % stories.length]!.id);
  return <div ref={root}><section onFocusCapture={event => setFocusWithin(event.target instanceof Element && event.target.matches(":focus-visible"))} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocusWithin(false); }} aria-label={pairId ? `${entry.stock.name} news` : "10X News: Trade The Narrative"} aria-roledescription="carousel" className={`stonklets-trending-news overflow-hidden bg-[#041204] text-[#b8d7b8] ${pairId ? "stonklets-news-inline" : "my-4 rounded-2xl border border-[#00ff00]/60"}`}>
    <div className="relative p-4">
      {!pairId && <button type="button" aria-label={expanded ? "Collapse trade the news" : "Expand trade the news"} aria-expanded={expanded} aria-controls={chartsId} className="stonklets-news-square absolute right-3 top-3" onClick={() => setExpanded(value => !value)}>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={expanded ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></svg>
      </button>}
      {!pairId && <h2 className="mb-3 pr-9 font-black text-[#00ff00]">10X News: Trade The Narrative</h2>}
      <div className="stonklets-news-headline-row" role="group" aria-roledescription="slide" aria-label={`${index + 1} of ${stories.length}`}>
        <div className="stonklets-news-identity">{renderIdentity(entry)}</div>
        <StonkletNewsHeadline headline={headline} url={lead?.url} publishedAt={lead?.publishedAt} attribution={lead?.publisher === "Yahoo Finance" ? "Yahoo Finance" : undefined} sector={thesis.relation === "sector"} evidence={thesis.evidence} expanded={expanded} onHover={setTitleHovered} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
      <nav className="stonklets-news-pagination" aria-label="Trade the news slides" onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); navigate(index + (event.key === "ArrowRight" ? 1 : -1)); } }}>
        {stories.map((story, i) => <button key={story.id} type="button" aria-label={`Go to news ${i + 1}`} aria-current={i === index ? "step" : undefined} onClick={() => navigate(i)} className="stonk-onboard-dot"><span className={i === index ? "is-active" : ""} /></button>)}
      </nav>
      <div className="flex shrink-0 items-center gap-2">
      <button type="button" aria-label="Next news" disabled={stories.length < 2} className="cursor-pointer rounded-lg border border-[#00ff00]/60 px-3 py-1.5 text-sm font-bold text-[#00ff00] hover:bg-[#00ff00]/10 disabled:opacity-40" onClick={() => navigate(index + 1)}>Next</button>
      <button type="button" className="stonklets-news-share h-8 shrink-0 cursor-pointer rounded-lg border border-[#00FF00]/55 bg-[#00FF00] px-3 text-xs font-bold text-[rgb(0,80,0)] hover:bg-[#33ff33]" onClick={() => onShare(entry, structuredClone(thesis))}>Share</button>
      </div>
      </div>
    </div>
    {!pairId && <div id={chartsId} hidden={!expanded}>{expanded && <div key={thesis.id}>{renderPair?.(entry.id)}</div>}</div>}
  </section></div>;
}

import { useEffect, useRef, useState } from "react";
import { AssetCard } from "./StonkletsApp";
import type { StonkletsMarketEntry } from "./stonkletsMarket";
import { parseStonkletChangeRange } from "../shared/stonkletsTime";

export default function StonkletShareRender({ id }: { id: string }) {
  const [entry, setEntry] = useState<StonkletsMarketEntry | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [renderedAt] = useState(() => new Date());
  const host = useRef<HTMLDivElement>(null);
  const range = parseStonkletChangeRange(new URLSearchParams(location.search).get("change")) ?? "24h";
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/stonklets/market?id=${encodeURIComponent(id)}&change=${range}`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Market unavailable");
      const payload = await response.json() as { entries: StonkletsMarketEntry[] };
      const match = payload.entries.find((item) => item.id === id);
      if (!match) throw new Error("Unknown Stonklet");
      setEntry(match);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [id, range]);
  useEffect(() => {
    if (!entry || !host.current) return;
    const check = () => {
      const charts = host.current?.querySelectorAll('.stonklets-chart');
      if (charts?.length === 2 && !host.current?.querySelector('.stonklets-chart-loading,[data-voters-ready="false"],[data-artwork-ready="false"]')) setReady(true);
    };
    const observer = new MutationObserver(check);
    observer.observe(host.current, { subtree: true, childList: true, attributes: true });
    check();
    return () => observer.disconnect();
  }, [entry]);
  return <div className="stonklet-share-canvas" ref={host} data-stonklet-share-ready={ready}>
    {entry ? <div className="stonklet-share-square"><article className="stonklets-pair"><div className="stonklets-chart-pair">
      {(["stonklet", "stock"] as const).map((asset) => <AssetCard key={asset} entry={entry} asset={asset} range={range} favourite={false} busy={false} onFavourite={() => {}} />)}
    </div><footer className="stonklet-share-timestamp">Snapshot {renderedAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC</footer></article></div> : <p>{error ? "Share image unavailable" : "Preparing Stonklet…"}</p>}
  </div>;
}

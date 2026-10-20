import { useEffect, useId, useState } from "react";
import type { Market } from "../../../discovery/src/model";
import { tokenImageSources } from "../../../discovery/src/images";
import { ArtworkResponseSchema, type Artwork } from "../../../discovery/src/artwork-model";
import { getJson, HistoryResponse, marketSource } from "./client";

const valueLabel = (v: number | null) => v === null ? "Unavailable" : v === 0 ? "$0" : v < .0001 ? `$${v.toExponential(3)}` : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: v < 1 ? 6 : 2 }).format(v);
export function useTokenArtwork(addresses: string[]) {
  const key = [...new Set(addresses)].sort().join(","), [artwork, setArtwork] = useState<Record<string, Artwork>>({});
  useEffect(() => {
    setArtwork({}); if (!key) return;
    const controller = new AbortController();
    const load = async () => {
      try { const response = await getJson(`/api/10x/artwork?addresses=${key}`, ArtworkResponseSchema, controller.signal); if (!controller.signal.aborted) setArtwork(response.data); }
      catch { /* Artwork is optional; identity and evidence stay readable. */ }
    };
    void load(); const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [key]);
  return artwork;
}
export function TokenImage({ url, metadataUrl, name, symbol, large = false }: { url?: string | null; metadataUrl?: string | null; name: string; symbol: string; large?: boolean }) {
  const sources = tokenImageSources(url, metadataUrl);
  return <TokenArtworkImage key={sources.join("|")} sources={sources} name={name} symbol={symbol} large={large} />;
}
function TokenArtworkImage({ sources, name, symbol, large }: { sources: string[]; name: string; symbol: string; large: boolean }) {
  const [index, setIndex] = useState(0), src = sources[index], size = large ? 144 : 88;
  return src ? <img className={`tenx-token-image${large ? " tenx-token-image--large" : ""}`} src={src} alt={`${name} token artwork`} width={size} height={size} loading={large ? "eager" : "lazy"} decoding="async" referrerPolicy="no-referrer" onError={() => setIndex(i => i + 1)} /> : <span className={`tenx-token-icon${large ? " tenx-token-image--large" : ""}`} role="img" aria-label={`${name}: image unavailable`}><span>{symbol.slice(0, 2)}</span><small>Image unavailable</small></span>;
}
function LineChart({ points, field, title }: { points: Market[]; field: "price_usd" | "market_cap_usd"; title: string }) {
  const id = useId(), [hover, setHover] = useState<number | null>(null);
  const valid = points.filter(p => p[field] !== null), values = valid.map(p => p[field]!);
  if (!valid.length) return <section className="tenx-chart-empty"><h3>{title}</h3><p>{field === "market_cap_usd" ? "The provider has not supplied reported market cap history. FDV is not used as market cap." : "Waiting for saved price observations."}</p></section>;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || Math.max(max * .1, .00000001);
  const start = Date.parse(points[0]!.fetched_at), end = Date.parse(points.at(-1)!.fetched_at), duration = end - start || 1;
  const xy = (p: Market) => [44 + (Date.parse(p.fetched_at) - start) / duration * 462, 148 - (p[field]! - min) / span * 112];
  const segments: string[] = []; let previous: Market | null = null;
  for (const p of points) {
    if (p[field] === null) { previous = null; continue; }
    const [x, y] = xy(p), joined = previous && previous.source === p.source && Date.parse(p.fetched_at) - Date.parse(previous.fetched_at) <= 1800000;
    segments.push(`${joined ? "L" : "M"}${x},${y}`); previous = p;
  }
  const selected = hover !== null && points[hover] ? points[hover]! : valid.at(-1)!;
  const [sx, sy] = selected[field] !== null ? xy(selected) : [0, 0];
  return <section className="tenx-chart"><div className="tenx-row"><h3>{title}</h3><strong>{valueLabel(selected[field])}</strong></div><p>{new Date(selected.fetched_at).toLocaleString()} · {marketSource(selected.source)} · fetched observation</p>
    <svg viewBox="0 0 530 176" role="img" aria-labelledby={id} onPointerMove={e => {
      const box = e.currentTarget.getBoundingClientRect(), timestamp = start + Math.max(0, Math.min(1, ((e.clientX - box.left) / box.width * 530 - 44) / 462)) * duration;
      let closest = 0; points.forEach((p, i) => { if (Math.abs(Date.parse(p.fetched_at) - timestamp) < Math.abs(Date.parse(points[closest]!.fetched_at) - timestamp)) closest = i; }); setHover(closest);
    }} onPointerLeave={() => setHover(null)}><title id={id}>{title}: {valid.length} saved observations. Minimum {valueLabel(min)}, maximum {valueLabel(max)}.</title>
      <line x1="44" y1="148" x2="506" y2="148" className="tenx-chart-grid" /><line x1="44" y1="36" x2="506" y2="36" className="tenx-chart-grid" />
      <text x="44" y="24">{valueLabel(max)}</text><text x="44" y="169">{new Date(start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</text><text x="506" y="169" textAnchor="end">{new Date(end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</text>
      <path d={segments.join(" ")} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />{valid.map(p => { const [x, y] = xy(p); return <circle key={p.fetched_at} cx={x} cy={y} r="1.8" fill="currentColor" />; })}{selected[field] !== null && <circle cx={sx} cy={sy} r="4" fill="currentColor" />}
    </svg>{points.length > 1 && <label className="tenx-chart-scrubber">Explore observations<input type="range" min={0} max={points.length - 1} value={hover ?? points.length - 1} onChange={e => setHover(Number(e.target.value))} aria-label={`${title} observation`} aria-valuetext={`${new Date(selected.fetched_at).toLocaleString()}: ${valueLabel(selected[field])}`} /></label>}{valid.length === 1 && <p>One observation so far; movement appears as new samples arrive.</p>}</section>;
}
export function TokenHistory({ address }: { address: string }) {
  const [hours, setHours] = useState(24), [points, setPoints] = useState<Market[]>([]), [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController(); setPoints([]); setError("");
    const load = async () => { try { const result = await getJson(`/api/10x/history/solana/${address}?hours=${hours}`, HistoryResponse, controller.signal); setPoints(result.data.points); setError(""); } catch { if (!controller.signal.aborted) setError("Saved chart history is temporarily unavailable."); } };
    void load(); const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [address, hours]);
  return <section className="tenx-panel"><div className="tenx-row"><h2>Price & market cap</h2><div className="tenx-chart-ranges" aria-label="History period">{[1, 24, 168].map(h => <button key={h} aria-pressed={hours === h} onClick={() => setHours(h)}>{h === 168 ? "7D" : `${h}H`}</button>)}</div></div>
    {error && <p role="alert">{error}</p>}<LineChart points={points} field="price_usd" title="Token price · USD" /><LineChart points={points} field="market_cap_usd" title="Market cap · USD" />
    <p>Source per observation: GeckoTerminal or DEX Screener · local observations only, up to 1,000 samples. Lines break across source changes, missing values and gaps over 30 minutes. Observation time at the provider is unavailable; fetch times are shown. No history is invented.</p>
    {!!points.length && <details><summary>Accessible data table ({points.length} samples)</summary><div className="tenx-table-scroll"><table><caption>Saved price and market cap observations</caption><thead><tr><th>Fetched</th><th>Price</th><th>Market cap</th></tr></thead><tbody>{points.map(p => <tr key={p.fetched_at}><td>{new Date(p.fetched_at).toLocaleString()}</td><td>{valueLabel(p.price_usd)}</td><td>{valueLabel(p.market_cap_usd)}</td></tr>)}</tbody></table></div></details>}
  </section>;
}

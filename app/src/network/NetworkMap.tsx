import { useEffect, useMemo, useRef, useState } from 'react';
import type { NetworkRow } from '../../shared/network/model';
type Position = [number, number];
interface Shape { code: string; name: string; center: Position; geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Position[][] | Position[][][] } }
const project = ([x, y]: Position): Position => [(x + 180) * 3, (90 - y) * 3];
function outline(shape: Shape) {
  const polygons = shape.geometry.type === 'Polygon' ? [shape.geometry.coordinates as Position[][]] : shape.geometry.coordinates as Position[][][];
  return polygons.flatMap(polygon => polygon.map(ring => ring.map((p, i) => `${i === 0 || Math.abs(p[0] - ring[i - 1][0]) > 180 ? 'M' : 'L'}${project(p).join(',')}`).join(' ') + ' Z')).join(' ');
}
export default function NetworkMap({ rows, selected, select, mode, shading }: { rows: NetworkRow[]; selected: string; select: (code: string) => void; mode: string; shading: boolean }) {
  const [shapes, setShapes] = useState<Shape[]>([]), [error, setError] = useState(false);
  const [zoom, setZoom] = useState(1), [pan, setPan] = useState<Position>([0, 0]);
  const [hover, setHover] = useState<Shape | null>(null);
  const drag = useRef<{ x: number; y: number; pan: Position; moved: boolean } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => { const abort = new AbortController(); void fetch('/network/countries.json', { signal: abort.signal }).then(r => { if (!r.ok) throw Error(); return r.json() as Promise<Shape[]>; }).then(setShapes).catch(e => { if (e.name !== 'AbortError') setError(true); }); return () => abort.abort(); }, []);
  const paths = useMemo(() => new Map(shapes.map(s => [s.code, outline(s)])), [shapes]);
  const byCountry = new Map(rows.map(r => [r.id, r]));
  const value = (row: NetworkRow | undefined) => mode==='wallet'?(row?.walletUsd==null?null:Number(row.walletUsd)):mode === 'status' ? row?.adoption ?? null : row?.population ?? null;
  const max=Math.max(1,...rows.map(row=>value(row)??0));
  const focus = (code: string) => { if (!drag.current?.moved) select(selected === code ? 'all' : code); };
  if (error) return <div className="network-map-message" role="alert">The map couldn’t load. Country rankings remain available below.</div>;
  return <div className="network-map-wrap">
    <div className="network-map-tools"><button aria-label="Zoom in" onClick={() => setZoom(z => Math.min(4, z * 1.4))}>+</button><button aria-label="Zoom out" onClick={() => setZoom(z => Math.max(1, z / 1.4))}>−</button><button onClick={() => { setZoom(1); setPan([0, 0]); select('all'); }}>World</button></div>
    {!shapes.length && <div className="network-map-message" role="status">Loading world map…</div>}
    <svg ref={svg} className="network-map" viewBox="0 0 1080 540" aria-label="Acceptance signers by country" role="group"
      onPointerDown={e => { drag.current = { x: e.clientX, y: e.clientY, pan, moved: false }; if (zoom > 1) e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={e => { if (!drag.current || !e.buttons || zoom === 1) return; const d = drag.current; if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) d.moved = true; const scale = 1080 / (svg.current?.clientWidth ?? 1080); setPan([Math.max(-500, Math.min(500, d.pan[0] + (e.clientX - d.x) * scale)), Math.max(-220, Math.min(220, d.pan[1] + (e.clientY - d.y) * scale))]); }}
      onPointerUp={() => { setTimeout(() => { drag.current = null; }, 0); }} onPointerCancel={() => { drag.current = null; }}>
      <defs><pattern id="network-grid" width="90" height="90" patternUnits="userSpaceOnUse"><path d="M90 0H0V90" fill="none" stroke="#1a2620" strokeWidth=".6" /></pattern></defs>
      <rect width="1080" height="540" fill="url(#network-grid)" />
      <g transform={`translate(${540 + pan[0]} ${270 + pan[1]}) scale(${zoom}) translate(-540 -270)`}>
        {shapes.map(shape => { const row = byCountry.get(shape.code), n = value(row); return <path key={shape.code} d={paths.get(shape.code)}
          className={`network-country ${selected === shape.code ? 'selected' : ''}`} fill={selected === shape.code ? '#1b633a' : shading && n ? `rgba(65,224,123,${.12 + .65 * Math.sqrt(n / max)})` : '#17221d'}
          strokeWidth={.8 / zoom} role="button" tabIndex={0} aria-label={`${shape.name}: ${n === null ? 'no allocated data' : `${n.toLocaleString()} ${mode==='wallet'?'supported USD':'signers'}`}`}
          onMouseEnter={() => setHover(shape)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(shape)} onBlur={() => setHover(null)}
          onClick={() => focus(shape.code)} onKeyDown={e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); select(shape.code === selected ? 'all' : shape.code); } }} />; })}
        {!shading && shapes.map(shape => { const row = byCountry.get(shape.code), n = value(row); if (!n) return null; const [cx, cy] = project(shape.center); return <g key={shape.code} pointerEvents="none"><circle cx={cx} cy={cy} r={(Math.sqrt(n / max) * 32) / Math.sqrt(zoom)} fill="#42df7b" fillOpacity=".13" stroke="#69f19a" strokeWidth={1 / zoom} /><circle cx={cx} cy={cy} r={2 / zoom} fill="#b5ffcd" /></g>; })}
      </g>
    </svg>
    <div className="network-map-key"><span className="network-dot" /> {shading ? 'Shading' : 'Bubble area'} represents {mode==='wallet'?'attributed supported wallet USD':mode === 'status' ? 'current opted-in accounts' : 'acceptance signers'} · <span>Select a country to meet its members</span></div>
    {hover && <div className="network-map-tooltip" role="status"><strong>{hover.name}</strong><span>{byCountry.get(hover.code)?.suppressed ? 'Below privacy threshold / complementary suppression' : value(byCountry.get(hover.code))?.toLocaleString() ?? 'No allocated data in this selection'}</span></div>}
  </div>;
}

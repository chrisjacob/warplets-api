import { useEffect, useMemo, useRef, useState } from 'react';
import type { NetworkPlace, NetworkRow } from '../../shared/network/model';
type Position = [number, number];
type Level = 'country' | 'state' | 'city';
interface Shape { code: string; name: string; center: Position; extent?: [number,number,number,number]; geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Position[][] | Position[][][] } }
const project = ([x,y]: Position): Position => [(x+180)*3,(90-y)*3];
const polygons = (s: Shape): Position[][][] => s.geometry.type === 'Polygon' ? [s.geometry.coordinates as Position[][]] : s.geometry.coordinates as Position[][][];
function outline(s: Shape) { return polygons(s).flatMap(p=>p.map(r=>r.map((v,i)=>`${!i || Math.abs(v[0]-r[i-1][0])>180?'M':'L'}${project(v).join(',')}`).join(' ')+' Z')).join(' '); }
function bounds(shape?: Shape, center?: Position): [number,number,number,number] {
  if (center) { const [x,y]=project(center); const width=Math.min(18,bounds(shape)[2]); return [x-width/2,y-width/4,width,width/2]; }
  if (!shape) return [0,0,1080,540];
  // Fit the main polygon rather than distant overseas territories.
  const rings=polygons(shape).map(p=>p[0]);
  const area=(r:Position[])=>Math.abs(r.reduce((a,p,i)=>{const n=r[(i+1)%r.length];return a+p[0]*n[1]-n[0]*p[1];},0));
  const ring=rings.sort((a,b)=>area(b)-area(a))[0] ?? (shape.extent ? [[shape.extent[0],shape.extent[1]],[shape.extent[2],shape.extent[3]]] as Position[] : undefined); if(!ring)return [0,0,1080,540];
  const points=ring.map(project), xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  const cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;
  const w=Math.max(1,(Math.max(...xs)-Math.min(...xs))*1.18,(Math.max(...ys)-Math.min(...ys))*2.36);
  return [cx-w/2,cy-w/4,w,w/2];
}
export default function NetworkMap({ rows,country,state,city,places,level,select,mode,shading }: { rows:NetworkRow[];country:string;state:string;city:string;places:NetworkPlace[];level:Level;select:(level:Level,id:string)=>void;mode:string;shading:boolean }) {
  const [world,setWorld]=useState<Shape[]>([]),[states,setStates]=useState<Shape[]>([]),[error,setError]=useState(false),[detailError,setDetailError]=useState(false);
  const [zoom,setZoom]=useState(1),[pan,setPan]=useState<Position>([0,0]),[hover,setHover]=useState<{id:string;name:string}|null>(null);
  const [mapWidth,setMapWidth]=useState(1080);
  const drag=useRef<{x:number;y:number;pan:Position;moved:boolean}|null>(null),svg=useRef<SVGSVGElement>(null);
  useEffect(()=>{const a=new AbortController();void fetch('/network/countries.json',{signal:a.signal}).then(r=>{if(!r.ok)throw Error();return r.json() as Promise<Shape[]>;}).then(setWorld).catch(e=>{if(e.name!=='AbortError')setError(true);});return()=>a.abort();},[]);
  useEffect(()=>{setStates([]);setDetailError(false);if(!/^[A-Z]{2}$/.test(country))return;const a=new AbortController();void fetch(`/network/states/${country}.json`,{signal:a.signal}).then(r=>{if(!r.ok)throw Error();return r.json() as Promise<Shape[]>;}).then(setStates).catch(e=>{if(e.name!=='AbortError')setDetailError(true);});return()=>a.abort();},[country]);
  useEffect(()=>{setZoom(1);setPan([0,0]);setHover(null);},[country,state,city]);
  useEffect(()=>{const el=svg.current;if(!el)return;const observer=new ResizeObserver(entries=>setMapWidth(entries[0].contentRect.width||1080));observer.observe(el);return()=>observer.disconnect();},[world.length]);
  const paths=useMemo(()=>new Map([...world,...states].map(s=>[s.code,outline(s)])),[world,states]);
  const selectedCity=places.find(p=>p.id===city);
  let box=bounds(states.find(s=>s.code===state)??world.find(s=>s.code===country),selectedCity?.lon!=null&&selectedCity.lat!=null?[selectedCity.lon,selectedCity.lat]:undefined);
  // Include observed city centers when a verified boundary is partial or absent.
  if(level==='city'&&city==='all'&&places.length){
    const points=places.filter(p=>p.lon!=null&&p.lat!=null).map(p=>project([p.lon!,p.lat!]));
    if(points.length){
      const left=Math.min(box[0],...points.map(p=>p[0])),right=Math.max(box[0]+box[2],...points.map(p=>p[0]));
      const top=Math.min(box[1],...points.map(p=>p[1])),bottom=Math.max(box[1]+box[3],...points.map(p=>p[1]));
      const width=Math.max(right-left,(bottom-top)*2);box=[(left+right-width)/2,(top+bottom-width/2)/2,width,width/2];
    }
  }
  const unit=box[2]/mapWidth;
  const byId=new Map(rows.map(r=>[r.id,r]));
  const value=(id:string)=>{const r=byId.get(id);return mode==='wallet'?(r?.walletUsd==null?null:Number(r.walletUsd)):r?.population??null;};
  const numberLabel=(n:number|null|undefined)=>(mode==='wallet'?Math.ceil(n??0):n??0).toLocaleString();
  const labelPoints: Position[]=[];
  const labels=new Set(places.filter(p=>byId.has(p.id)).sort((a,b)=>(byId.get(b.id)?.population??0)-(byId.get(a.id)?.population??0)).filter(p=>{const [x,y]=project([p.lon!,p.lat!]);if(labelPoints.length>=4||labelPoints.some(([px,py])=>Math.hypot(px-x,py-y)<80*unit))return false;labelPoints.push([x,y]);return true;}).map(p=>p.id));
  const max=Math.max(1,...rows.filter(r=>r.id!=='UNKNOWN'&&r.id!=='UNAVAILABLE').map(r=>value(r.id)??0));
  const focus=(id:string)=>{if(!drag.current?.moved)select(level,id);};
  function zoomOut() {
    if (zoom > 1.001) {
      const next = Math.max(1, zoom / 1.4);
      setZoom(next < 1.001 ? 1 : next);
      if (next < 1.001) setPan([0,0]);
      return;
    }
    setPan([0,0]);
    if (city !== 'all') select('city','all');
    else if (state !== 'all') select('state','all');
    else if (country !== 'all') select('country','all');
  }
  const interactive=level==='country'?world:level==='state'?states:[];
  const stateShapes=states.filter(s=>s.code===state);
  const boundary=level==='city'?(stateShapes.some(s=>paths.get(s.code))?stateShapes:world.filter(s=>s.code===country)):level==='state'?world.filter(s=>s.code===country):[];
  if(error)return <div className="network-map-message" role="alert">Map unavailable. Choose a place from the ranking.</div>;
  return <div className="network-map-wrap">
    <div className="network-map-tools"><button aria-label="Zoom in" onClick={()=>setZoom(z=>Math.min(12,z*1.4))}>+</button><button aria-label="Zoom out" title={zoom>1.001?'Zoom out':city!=='all'?'Back to state':state!=='all'?'Back to country':'Back to world'} onClick={zoomOut}>−</button><button onClick={()=>select('country','all')}>World</button></div>
    <svg ref={svg} className="network-map" viewBox={box.join(' ')} role="group" aria-label={`Members by ${level}`}
      onPointerDown={e=>{drag.current={x:e.clientX,y:e.clientY,pan,moved:false};}}
      onPointerMove={e=>{if(!drag.current||!e.buttons||zoom===1)return;const d=drag.current;if(Math.hypot(e.clientX-d.x,e.clientY-d.y)>5){d.moved=true;e.currentTarget.setPointerCapture(e.pointerId);}const scale=box[2]/(svg.current?.clientWidth??1080);setPan([d.pan[0]+(e.clientX-d.x)*scale,d.pan[1]+(e.clientY-d.y)*scale]);}}
      onPointerUp={()=>{setTimeout(()=>{drag.current=null;},0);}} onPointerCancel={()=>{drag.current=null;}}>
      <g transform={`translate(${box[0]+box[2]/2+pan[0]} ${box[1]+box[3]/2+pan[1]}) scale(${zoom}) translate(${-box[0]-box[2]/2} ${-box[1]-box[3]/2})`}>
        {boundary.map(s=><path key={s.code} d={paths.get(s.code)} fill="#17221d" stroke="#50745b" strokeWidth={unit/zoom}/>)}
        {interactive.map(s=>{const n=value(s.code);if(!paths.get(s.code))return null;return <path key={s.code} className="network-country" d={paths.get(s.code)} fill={shading&&n?`rgba(65,224,123,${.12+.65*Math.sqrt(n/max)})`:'#17221d'} strokeWidth={unit/zoom} role="button" tabIndex={0} aria-label={`${s.name}: ${numberLabel(n)} ${mode==='wallet'?'USD':'members'}`} onMouseEnter={()=>setHover({id:s.code,name:s.name})} onMouseLeave={()=>setHover(null)} onFocus={()=>setHover({id:s.code,name:s.name})} onBlur={()=>setHover(null)} onClick={()=>focus(s.code)} onKeyDown={e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();focus(s.code);}}}/>;})}
        {interactive.filter(s=>!shading||!paths.get(s.code)).map(s=>{const n=value(s.code);if(!n)return null;const [x,y]=project(s.center);return <circle key={s.code} cx={x} cy={y} r={(3+Math.sqrt(n/max)*26)*unit/Math.sqrt(zoom)} fill="#42df7b" fillOpacity=".2" stroke="#69f19a" strokeWidth={unit/zoom} pointerEvents={paths.get(s.code)?'none':'auto'}
          className={!paths.get(s.code)?'network-state-point':undefined} role={!paths.get(s.code)?'button':undefined} tabIndex={!paths.get(s.code)?0:undefined}
          aria-label={!paths.get(s.code)?`${s.name}: ${numberLabel(n)} ${mode==='wallet'?'USD':'members'}`:undefined}
          onClick={()=>{if(!paths.get(s.code))focus(s.code);}} onKeyDown={e=>{if(!paths.get(s.code)&&['Enter',' '].includes(e.key)){e.preventDefault();focus(s.code);}}}
          onMouseEnter={()=>{if(!paths.get(s.code))setHover({id:s.code,name:s.name});}} onMouseLeave={()=>setHover(null)} onFocus={()=>setHover({id:s.code,name:s.name})} onBlur={()=>setHover(null)}/>;})}
        {level==='city'&&places.filter(p=>byId.has(p.id)).map(p=>{const [x,y]=project([p.lon!,p.lat!]),n=value(p.id);return <g key={p.id} className="network-city" role="button" tabIndex={0} aria-label={`${p.name}: ${numberLabel(n)} ${mode==='wallet'?'USD':'members'}`} onClick={()=>focus(p.id)} onKeyDown={e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();focus(p.id);}}} onMouseEnter={()=>setHover(p)} onMouseLeave={()=>setHover(null)} onFocus={()=>setHover(p)} onBlur={()=>setHover(null)}><circle cx={x} cy={y} r={(5+Math.sqrt((n??0)/max)*14)*unit/zoom} fill={p.id===city?'#42df7b':'#235e38'} stroke="#a7eabc" strokeWidth={1} vectorEffect="non-scaling-stroke"/>{(labels.has(p.id)||p.id===city||hover?.id===p.id)&&<text x={x} y={y-25*unit/zoom} fontSize={12*unit/zoom} textAnchor="middle" fill="#dcebe0">{p.name}</text>}</g>;})}
      </g>
    </svg>
    <div className="network-map-key"><span className="network-dot"/>{mode==='wallet'?'Supported wallet USD · ':''}{level==='country'?'Choose a country':level==='state'?'Choose a state or province':'Choose a city'}{detailError?' · Boundaries unavailable; use the ranking':''}</div>
    {hover&&<div className="network-map-tooltip" role="status"><strong>{hover.name}</strong><span>{numberLabel(value(hover.id))} {mode==='wallet'?'USD':'members'}</span></div>}
  </div>;
}

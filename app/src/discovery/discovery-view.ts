import {ComparisonAddresses} from "../../../discovery/src/discovery-comparison-model";

export function comparisonSelection(raw:string|null){if(!raw)return[];const parsed=ComparisonAddresses.safeParse(raw.split(","));return parsed.success?parsed.data:[];}
export type DiscoveryView={mode:"live"|"fixture";status:"all"|"eligible"|"provisional"|"excluded";age:"24h"|"all";sort:"score"|"liquidity";layout:"cards"|"table";q:string;freshness:"all"|"fresh"|"stale"|"missing";min_liquidity:number;min_coverage:number;compare:string[]};
export const defaults:DiscoveryView={mode:"live",status:"all",age:"24h",sort:"score",layout:"cards",q:"",freshness:"all",min_liquidity:0,min_coverage:0,compare:[]};
export function discoveryView(search:string):DiscoveryView{
  const p=new URLSearchParams(search), choice=<K extends keyof DiscoveryView>(key:K,values:readonly DiscoveryView[K][])=>values.includes(p.get(key) as DiscoveryView[K])?p.get(key) as DiscoveryView[K]:defaults[key];
  const number=(key:"min_liquidity"|"min_coverage",max:number)=>{const n=Number(p.get(key));return Number.isFinite(n)&&n>=0&&n<=max?n:0;};
  return {mode:choice("mode",["live","fixture"]),status:choice("status",["all","eligible","provisional","excluded"]),age:choice("age",["24h","all"]),sort:choice("sort",["score","liquidity"]),layout:choice("layout",["cards","table"]),q:(p.get("q")??"").trim().slice(0,100),freshness:choice("freshness",["all","fresh","stale","missing"]),min_liquidity:number("min_liquidity",1e12),min_coverage:number("min_coverage",100),compare:comparisonSelection(p.get("compare"))};
}
export function discoveryViewParams(view:DiscoveryView){return new URLSearchParams(Object.entries(view).map(([k,v])=>[k,String(v)]));}

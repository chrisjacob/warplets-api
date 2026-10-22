// Test-only native builder route. Never imported by production configuration.
import router,{type LocalEnv} from "../../discovery/src/worker";
import {authorized,API_HEADERS} from "../../discovery/src/request-security";
import type {D1Trace} from "./discovery-serving-workload";
type StudyEnv={STUDY_DB:D1Database;STUDY_TOKEN:string;STUDY_NOW:string};
export function traceBuilderDatabase(db:D1Database,trace:D1Trace[]):D1Database{
  const originals=new WeakMap<D1PreparedStatement,D1PreparedStatement>(),sqls=new WeakMap<D1PreparedStatement,string>();
  const record=(sql:string,result:D1Result)=>trace.push({sql,rows_read:result.meta.rows_read??null,rows_written:result.meta.rows_written??null,changes:result.meta.changes??null,returned_rows:result.results.length});
  const wrap=(statement:D1PreparedStatement,sql:string):D1PreparedStatement=>{
    const proxy=new Proxy(statement,{get(target,key){
      if(key==="bind")return(...values:unknown[])=>wrap(target.bind(...values),sql);
      if(key==="first")return async(column?:string)=>{const r=await target.all();record(sql,r);const row=r.results[0];return row?(column?row[column]:row):null;};
      if(key==="all"||key==="run")return async()=>{const r=await target[key]();record(sql,r);return r;};
      if(key==="raw")return()=>{throw Error("builder_trace_raw_forbidden");};
      const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
    }});originals.set(proxy,statement);sqls.set(proxy,sql);return proxy;
  };
  return new Proxy(db,{get(target,key){
    if(key==="prepare")return(sql:string)=>{
      if(!/^SELECT\s/i.test(sql)&&! /^(?:INSERT INTO|DELETE FROM) tenx_score_page_(?:cards|summaries|manifest)\b/i.test(sql))throw Error("builder_trace_source_write_forbidden");
      return wrap(target.prepare(sql),sql);
    };
    if(key==="batch")return async(statements:D1PreparedStatement[])=>{if(statements.some(s=>!originals.has(s)))throw Error("builder_trace_foreign_statement");const r=await target.batch(statements.map(s=>originals.get(s)!));r.forEach((v,i)=>record(sqls.get(statements[i]!)!,v));return r;};
    if(key==="exec"||key==="dump"||key==="withSession")return()=>{throw Error("builder_trace_method_forbidden");};
    const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
  }});
}
const NativeDate=Date;let clock:string|undefined;
export default {async fetch(request:Request,env:StudyEnv){
  const url=new URL(request.url);
  if(!["localhost","127.0.0.1"].includes(url.hostname)||!authorized(new Request(request.url,{headers:{authorization:`Bearer ${request.headers.get("x-study-token")??""}`}}),env.STUDY_TOKEN))return new Response(null,{status:403});
  if(!["GET","POST"].includes(request.method))return new Response(null,{status:405});
  if(url.pathname!=="/api/10x/admin/score-read-pages")return new Response(null,{status:404});
  if(!Number.isFinite(NativeDate.parse(env.STUDY_NOW))||clock!==undefined&&clock!==env.STUDY_NOW)throw Error("builder_fixture_clock_changed");
  if(clock===undefined){clock=env.STUDY_NOW;const at=NativeDate.parse(clock);globalThis.Date=class extends NativeDate{constructor(value?:string|number){super(value??at);}static now(){return at;}} as DateConstructor;}
  const trace:D1Trace[]=[],copy=new Request(request),probe=request.headers.get("x-study-probe");if(probe==="bad_origin")copy.headers.set("origin","https://evil.invalid");
  const nativeRequest=probe==="external_host"?new Request(new URL(url.pathname+url.search,"https://outside.invalid"),copy):copy;
  const local:LocalEnv={TENX_DB:traceBuilderDatabase(env.STUDY_DB,trace),TENX_LOCAL_ONLY:probe==="runtime_disabled"?"false":"true",TENX_RESEARCH_MODE:"bounded",TENX_NODE_RELAY:"false",TENX_ADMIN_TOKEN:env.STUDY_TOKEN,TENX_RPC_URL:"https://offline.invalid",TENX_RPC_DAILY_LIMIT:"5000",TENX_MARKET_DAILY_LIMIT:"600",TENX_MARKET_ENABLED:"false",TENX_MARKET_PROVIDER:"dexscreener",TENX_QUALITY_ENABLED:"false",TENX_QUALITY_RPC_DAILY_LIMIT:"1800",TENX_WALLET_ANALYSIS_ENABLED:"false",TENX_WALLET_RPC_DAILY_LIMIT:"800"};
  const response=await router.fetch(nativeRequest,local);
  return new Response(JSON.stringify({response:await response.json(),trace}),{status:response.status,headers:API_HEADERS});
}};

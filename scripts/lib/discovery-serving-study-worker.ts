// Test-only router entry. No production configuration imports this module.
import router,{type LocalEnv} from "../../discovery/src/worker";
import {authorized,API_HEADERS} from "../../discovery/src/request-security";
type StudyEnv={STUDY_DB:D1Database;STUDY_TOKEN:string;STUDY_NOW:string};
type Trace={sql:string;rows_read:number|null;rows_written:number|null;returned_rows:number};
export function traceServingDatabase(db:D1Database,trace:Trace[]):D1Database{
  const originals=new WeakMap<D1PreparedStatement,D1PreparedStatement>(),sqls=new WeakMap<D1PreparedStatement,string>();
  const record=(sql:string,result:D1Result)=>{if(result.meta.rows_written!==0)throw Error("serving_read_wrote_rows");trace.push({sql,rows_read:result.meta.rows_read??null,rows_written:result.meta.rows_written??null,returned_rows:result.results.length});};
  const wrap=(statement:D1PreparedStatement,sql:string):D1PreparedStatement=>{
    const proxy=new Proxy(statement,{get(target,key){
      if(key==="bind")return(...values:unknown[])=>wrap(target.bind(...values),sql);
      if(key==="run"||key==="raw")return()=>{throw Error("serving_trace_method_forbidden");};
      if(key==="all")return async()=>{const result=await target.all();record(sql,result);return result;};
      if(key==="first")return async(column?:string)=>{const result=await target.all();record(sql,result);const row=result.results[0];return row?(column?row[column]:row):null;};
      const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
    }});originals.set(proxy,statement);sqls.set(proxy,sql);return proxy;
  };
  return new Proxy(db,{get(target,key){
    if(key==="prepare")return(sql:string)=>{if(!/^SELECT\s/i.test(sql))throw Error("serving_trace_write_forbidden");return wrap(target.prepare(sql),sql);};
    if(key==="batch")return async(statements:D1PreparedStatement[])=>{if(statements.some(s=>!originals.has(s)))throw Error("serving_trace_foreign_statement");const results=await target.batch(statements.map(s=>originals.get(s)!));results.forEach((r,i)=>record(sqls.get(statements[i]!)!,r));return results;};
    if(key==="exec"||key==="dump")return()=>{throw Error("serving_trace_method_forbidden");};
    const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
  }});
}
let clock:string|undefined;
const NativeDate=Date;
export default {async fetch(request:Request,env:StudyEnv){
  const url=new URL(request.url);
  if(!["localhost","127.0.0.1"].includes(url.hostname)||!authorized(new Request(request.url,{headers:{authorization:`Bearer ${request.headers.get("x-study-token")??""}`}}),env.STUDY_TOKEN))return new Response(null,{status:403});
  if(request.method!=="GET")return new Response(null,{status:405});
  if(!["/api/10x/candidates","/api/10x/admin/score-read-pages"].includes(url.pathname))return new Response(null,{status:404});
  // One immutable historical clock per isolated fixture, never production time.
  if(!Number.isFinite(NativeDate.parse(env.STUDY_NOW))||clock!==undefined&&clock!==env.STUDY_NOW)throw Error("serving_fixture_clock_changed");
  if(clock===undefined){clock=env.STUDY_NOW;const at=NativeDate.parse(clock);globalThis.Date=class extends NativeDate{constructor(value?:string|number){super(value??at);}static now(){return at;}} as DateConstructor;}
  const trace:Trace[]=[],traced=request.headers.get("x-study-trace")==="1",db=traced?traceServingDatabase(env.STUDY_DB,trace):env.STUDY_DB;
  const probe=request.headers.get("x-study-probe");
  const nativeRequest=probe==="external_host"?new Request(new URL(url.pathname+url.search,"https://outside.invalid"),request):new Request(request);
  if(probe==="bad_origin")nativeRequest.headers.set("origin","https://evil.invalid");
  const local:LocalEnv={TENX_DB:db,TENX_LOCAL_ONLY:probe==="runtime_disabled"?"false":"true",TENX_RESEARCH_MODE:"bounded",TENX_NODE_RELAY:"false",TENX_ADMIN_TOKEN:env.STUDY_TOKEN,TENX_RPC_URL:"https://offline.invalid",TENX_RPC_DAILY_LIMIT:"5000",TENX_MARKET_DAILY_LIMIT:"600",TENX_MARKET_ENABLED:"false",TENX_MARKET_PROVIDER:"dexscreener",TENX_QUALITY_ENABLED:"false",TENX_QUALITY_RPC_DAILY_LIMIT:"1800",TENX_WALLET_ANALYSIS_ENABLED:"false",TENX_WALLET_RPC_DAILY_LIMIT:"800"};
  const response=await router.fetch(nativeRequest,local);
  return traced?new Response(JSON.stringify({response:await response.json(),trace}),{status:response.status,headers:API_HEADERS}):response;
}};

// Test-only entry point, bundled solely by discovery-read-runtime-study.ts.
// Never deploy or attach application bindings/credentials to this harness.
import {readScoreReadPages} from "../../discovery/src/score-read-pages";
import {API_HEADERS,authorized,requireAdminBrowser,RequestSecurityError} from "../../discovery/src/request-security";

type StudyEnv={STUDY_DB:D1Database;STUDY_TOKEN:string;STUDY_NOW:string};
type QueryTrace={kind:string;rows_read:number|null;rows_written:number|null;duration_ms:number|null;returned_rows:number;payload_bytes:number};
const queryKind=(sql:string)=>{
  if(sql.startsWith("SELECT r.revision,"))return "manifest";
  if(sql.startsWith("SELECT c.address,"))return "bodies";
  if(sql.startsWith("SELECT s.page,"))return "summaries";
  throw Error("unexpected_reader_sql");
};
function tracedDatabase(db:D1Database,trace:QueryTrace[],race:string|null){
  const originals=new WeakMap<D1PreparedStatement,D1PreparedStatement>(),kinds=new WeakMap<D1PreparedStatement,string>();
  const record=(kind:string,result:D1Result)=>trace.push({kind,rows_read:result.meta.rows_read??null,rows_written:result.meta.rows_written??null,duration_ms:result.meta.duration??null,
    returned_rows:result.results.length,payload_bytes:new TextEncoder().encode(JSON.stringify(result.results)).byteLength});
  const wrap=(statement:D1PreparedStatement,kind:string):D1PreparedStatement=>{
    const proxy=new Proxy(statement,{get(target,key){
      if(key==="bind")return(...values:unknown[])=>wrap(target.bind(...values),kind);
      // first() does not expose D1 metadata. The separate trace pass uses all()
      // and returns the same first-row/column result. Timed reads use native first().
      if(key==="first")return async(column?:string)=>{const result=await target.all();record(kind,result);const row=result.results[0];return row?(column?row[column]:row):null;};
      const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
    }});originals.set(proxy,statement);kinds.set(proxy,kind);return proxy;
  };
  return new Proxy(db,{get(target,key){
    if(key==="prepare")return(sql:string)=>wrap(target.prepare(sql),queryKind(sql));
    if(key==="batch")return async(statements:D1PreparedStatement[])=>{
      if(race==="revision")await target.prepare("UPDATE tenx_score_source_revision SET revision=revision+1 WHERE id=1").run();
      if(race==="generation")await target.prepare("UPDATE tenx_score_page_manifest SET manifest_hash=? WHERE id=1").bind("0".repeat(64)).run();
      const results=await target.batch(statements.map(s=>originals.get(s)??s));results.forEach((r,i)=>record(kinds.get(statements[i]!)??"unknown",r));return results;
    };
    const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
  }});
}
export default {async fetch(request:Request,env:StudyEnv){
  const url=new URL(request.url);
  if(!["localhost","127.0.0.1"].includes(url.hostname))return new Response(null,{status:403});
  if(!authorized(request,env.STUDY_TOKEN))return new Response(null,{status:401});
  try{requireAdminBrowser(request);}catch(error){if(error instanceof RequestSecurityError)return new Response(null,{status:error.status});throw error;}
  if(request.method!=="GET")return new Response(null,{status:405});
  if(url.pathname!=="/study/reader")return new Response(null,{status:404});
  const trace:QueryTrace[]=[],instrumented=url.searchParams.get("__trace")==="1",race=url.searchParams.get("__race"),expired=url.searchParams.get("__expired")==="1";
  for(const key of ["__trace","__race","__expired"])url.searchParams.delete(key);
  const db=instrumented?tracedDatabase(env.STUDY_DB,trace,race):env.STUDY_DB;
  const result=await readScoreReadPages(db,Object.fromEntries(url.searchParams),new Date(Date.parse(env.STUDY_NOW)+(expired?60000:0)));
  return new Response(JSON.stringify(instrumented?{result,trace}:result),{headers:API_HEADERS});
}};

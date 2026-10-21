import {z} from "zod";
const N=z.number().finite().nonnegative(),Count=N.int().safe(),Hash=z.string().regex(/^[a-f0-9]{64}$/);
const Query=z.record(z.string().max(100),z.string().max(512));
const Wall=z.object({requests:Count.positive(),p50_ms:N,p95_ms:N,max_ms:N,mean_ms:N}).strict().refine(v=>v.p50_ms<=v.p95_ms&&v.p95_ms<=v.max_ms&&v.mean_ms<=v.max_ms,"inconsistent_latency");
const Trace=z.object({kind:z.enum(["manifest","bodies","summaries"]),rows_read:Count,rows_written:z.literal(0),duration_ms:N,returned_rows:Count,payload_bytes:Count}).strict();
const Race=z.object({race:z.enum(["revision","generation"]),empty:z.boolean(),state:z.literal("held"),reason:z.literal("source_or_generation_changed")}).strict();
const Measure=z.object({kind:z.literal("measure"),startup_and_seed_ms:N,first_read_ms:N,cases:z.object({query:Query,response_bytes:Count,wall:Wall,trace:Trace.array().length(3)}).strict().array().min(1).max(32),
  concurrency:z.object({width:Count.positive(),batches:Count.positive(),wall:Wall,batch_wall:Wall}).strict().array().length(2),no_read_writes:z.literal(true),
  guards:z.object({unauthorized:z.literal(401),bad_origin:z.literal(403),expired:z.literal("cutoff_expired_or_future")}).strict(),races:Race.array().length(4)}).strict();
const Profile=z.object({query:Query,requests:Count.positive(),artifact:z.string().regex(/^[a-z0-9_-]+\.cpuprofile$/),sha256:Hash,cpu_acceptance:z.literal(false)}).passthrough();
const Run=z.discriminatedUnion("kind",[Measure,z.object({kind:z.enum(["cold_first","cold_repeat"]),startup_and_seed_ms:N,first_read_ms:N}).strict(),
  z.object({kind:z.literal("profile"),profiles:Profile.array().min(1).max(2),no_read_writes:z.literal(true)}).strict()]);
export const RuntimeStudySchema=z.object({version:z.literal("full-reader-workerd-d1-study-v1"),compatibilityDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),compatibilityFlags:z.string().max(100).array().max(32),cutoff:z.iso.datetime(),
  studies:z.object({shape:z.enum(["ordinary_244","distinct_wide_500"]),candidates:Count.positive(),built:z.object({state:z.literal("built"),manifest_hash:Hash,cutoff:z.iso.datetime(),candidates:Count.positive(),manifest_bytes:Count,card_bytes:Count,
    writes:z.object({removed_bodies:Count,changed_bodies:Count,removed_summary_pages:Count,changed_summary_pages:Count,manifest:Count}).strict(),action_authority:z.literal(false)}).strict(),first_read_after_new_runtime:Wall,runs:Run.array().length(4)}).strict().array().length(2),
  limits:z.string().max(10000),cpu_acceptance:z.literal(false)}).strict();

const stable=(value:unknown):string=>JSON.stringify(value,(_key,v)=>v&&typeof v==="object"&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0)):v);
const requireEqual=(a:unknown,b:unknown,label:string)=>{if(stable(a)!==stable(b))throw Error("incomparable_runtime_reports:"+label);};
const change=(before:number,after:number)=>({before_ms:before,after_ms:after,delta_ms:after-before,change_pct:before===0?null:(after/before-1)*100});
const wallChange=(before:z.infer<typeof Wall>,after:z.infer<typeof Wall>)=>{requireEqual(before.requests,after.requests,"sample_count");return {requests:before.requests,p50:change(before.p50_ms,after.p50_ms),p95:change(before.p95_ms,after.p95_ms),max:change(before.max_ms,after.max_ms),mean:change(before.mean_ms,after.mean_ms)};};
function validateShape(study:z.infer<typeof RuntimeStudySchema>["studies"][number]){
  const wide=study.shape==="distinct_wide_500",measure=study.runs.find(r=>r.kind==="measure"),profile=study.runs.find(r=>r.kind==="profile");
  if(new Set(study.runs.map(r=>r.kind)).size!==4||!measure||!profile||study.candidates!==(wide?500:244)||study.built.candidates!==study.candidates||measure.cases.length!==(wide?6:5)||profile.profiles.length!==(wide?2:1))throw Error("invalid_runtime_fixture");
  if(new Set(measure.cases.map(c=>stable(c.query))).size!==measure.cases.length||new Set(measure.races.map(r=>stable([r.race,r.empty]))).size!==4)throw Error("missing_runtime_case");
  if(new Set(measure.concurrency.map(c=>c.width)).size!==2||measure.concurrency.some(c=>![4,16].includes(c.width)||c.batches!==3||c.wall.requests!==c.width*c.batches||c.batch_wall.requests!==c.batches))throw Error("invalid_runtime_concurrency");
  if(measure.cases.some(c=>c.wall.requests!==20||c.trace.some((t,i)=>t.kind!==["manifest","bodies","summaries"][i])))throw Error("invalid_runtime_trace");
  if(new Set(profile.profiles.map(p=>stable(p.query))).size!==profile.profiles.length||new Set(profile.profiles.map(p=>p.artifact)).size!==profile.profiles.length||profile.profiles.some(p=>p.requests!==40||!measure.cases.some(c=>stable(c.query)===stable(p.query)))||study.first_read_after_new_runtime.requests!==3)throw Error("invalid_runtime_profile");
  return {measure,profile};
}
export function compareRuntimeStudies(beforeInput:unknown,afterInput:unknown){
  const before=RuntimeStudySchema.parse(beforeInput),after=RuntimeStudySchema.parse(afterInput);
  requireEqual([before.version,before.compatibilityDate,before.compatibilityFlags,before.cutoff],[after.version,after.compatibilityDate,after.compatibilityFlags,after.cutoff],"runtime_identity");
  requireEqual(before.limits,after.limits,"measurement_scope");
  if(new Set(before.studies.map(s=>s.shape)).size!==2||new Set(after.studies.map(s=>s.shape)).size!==2)throw Error("duplicate_runtime_fixture");
  const studies=before.studies.map(old=>{const next=after.studies.find(s=>s.shape===old.shape)!;const a=validateShape(old),b=validateShape(next);
    requireEqual(old.built,next.built,"manifest_and_publication");requireEqual(old.built.cutoff,before.cutoff,"before_cutoff");requireEqual(next.built.cutoff,after.cutoff,"after_cutoff");
    requireEqual(a.measure.guards,b.measure.guards,"guards");requireEqual(a.measure.races.map(stable).sort(),b.measure.races.map(stable).sort(),"races");
    requireEqual(a.profile.profiles.map(p=>stable([p.query,p.requests])).sort(),b.profile.profiles.map(p=>stable([p.query,p.requests])).sort(),"profile_queries");
    const cases=a.measure.cases.map(c=>{const other=b.measure.cases.find(v=>stable(v.query)===stable(c.query));if(!other)throw Error("missing_runtime_query");
      requireEqual(c.response_bytes,other.response_bytes,"response_bytes");
      requireEqual(c.trace.map(({duration_ms:ignored,...t})=>t),other.trace.map(({duration_ms:ignored,...t})=>t),"read_contract");
      return {query:c.query,response_bytes:c.response_bytes,wall:wallChange(c.wall,other.wall)};});
    const concurrency=a.measure.concurrency.map(c=>{const other=b.measure.concurrency.find(v=>v.width===c.width)!;return {width:c.width,batches:c.batches,wall:wallChange(c.wall,other.wall),batch_wall:wallChange(c.batch_wall,other.batch_wall)};});
    return {shape:old.shape,manifest_hash:old.built.manifest_hash,identical_data_and_guards:true,first_request:wallChange(old.first_read_after_new_runtime,next.first_read_after_new_runtime),cases,concurrency};
  });
  return {version:"full-reader-runtime-comparison-v1",studies,cpu_acceptance:false,promotion_authorized:false,semantics:"All query results retained; elapsed comparisons are descriptive, not causal or billed CPU certification."};
}

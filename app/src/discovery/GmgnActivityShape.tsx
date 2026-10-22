import type { GmgnActivityShapeResult } from "../../../discovery/src/gmgn-activity-shape";
import { GMGN_ACTIVITY_EVENT_LIMIT } from "../../../discovery/src/gmgn-wallet-activity";

export function GmgnActivityShapeDetails({shape}:{shape:GmgnActivityShapeResult|undefined}) {
  if(!shape)return null;
  const eventLimit=shape.accepted_event_limit??GMGN_ACTIVITY_EVENT_LIMIT;
  const describe=(kind:string,count:number|null)=>kind==="array"?`${count} row${count===1?"":"s"}`:kind;
  return <details><summary>Response structure for this held attempt</summary>
    <p>Expected event array: {describe(shape.activities,shape.activities_count)}. Nested event array: {describe(shape.data_activities,shape.data_activities_count)}. List field: {describe(shape.list,shape.list_count)}.</p>
    {shape.activities==="array"&&shape.activities_count!==null&&shape.activities_count>eventLimit&&<p>GMGN returned {shape.activities_count} events; this validator accepts at most {eventLimit}. The whole page was held; no rows were discarded.</p>}
    {shape.validation_checks.length>0&&<ul>{shape.validation_checks.map((item,i)=><li key={i}>{item.field}: {item.check==="event_type_missing_or_conflicting"?"event type missing or conflicting":item.code.replaceAll("_"," ")}</li>)}</ul>}
    <p>Only field types and array counts were saved. This diagnostic does not validate events, establish zero activity or change scores.</p>
  </details>;
}

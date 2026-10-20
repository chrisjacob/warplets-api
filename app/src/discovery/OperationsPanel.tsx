import type {z} from "zod";
import type {OperationsSchema} from "../../../discovery/src/operations-model";
import {readableReason} from "./client";
type Data=z.infer<typeof OperationsSchema>;
const time=(s:string|null)=>s?new Date(s).toLocaleString("en-AU",{timeZone:"Australia/Sydney"}):"Not observed";
export function OperationsPanel({data,error}:{data:Data|null;error:string}){
  return <section className="tenx-panel" id="operational-health"><h2>Is local automation working?</h2>
    {error&&<p role="alert">Operational health could not refresh. {data?"The last response remains visible.":"Check the local discovery service."}</p>}
    {data?<><p>Operational state: <strong>{data.state}</strong>. Collection heartbeat: <strong>{data.timer}</strong>, observed {time(data.heartbeat_at)}. The heartbeat is considered stale after 20 minutes to allow bounded source work to finish.</p>
      <dl><dt>Independent local watchdog</dt><dd>{data.watchdog.last?readableReason(data.watchdog.last.code):"No independent check retained yet"}</dd><dt>Last independent check</dt><dd>{time(data.watchdog.last?.checked_at??null)} · {data.watchdog.fresh?"recent":"missing or stale"}</dd><dt>Abandoned discovery attempts</dt><dd>{data.abandoned_jobs}</dd></dl>
      {!!data.issues.length&&<details open><summary>Operational issues ({data.issues.length})</summary><ul>{data.issues.map(issue=><li key={issue}>{readableReason(issue)}</li>)}</ul></details>}
      <div className="tenx-table-scroll"><table><thead><tr><th>Collector</th><th>State</th><th>Next due</th><th>Last success</th></tr></thead><tbody>{data.loops.map(loop=><tr key={loop.name}><td>{loop.name}</td><td>{readableReason(loop.state)}{loop.last_error&&<p>{readableReason(loop.last_error)}</p>}</td><td>{time(loop.next_at)}</td><td>{time(loop.last_success)}</td></tr>)}</tbody></table></div>
      <details><summary>Recent watchdog transitions ({data.watchdog.events.length})</summary><ul>{data.watchdog.events.map((event,i)=><li key={`${event.checked_at}:${i}`}>{time(event.checked_at)} · {readableReason(event.code)}</li>)}</ul></details>
      <p className="tenx-footnote">The supervisor checks independently of the collection timer. Three consecutive runtime or timer failures can restart only its own launcher; source backoff, pause and exhausted quotas do not request a restart. Starts are capped at three per 15 minutes. Observations stay in local logs and this dashboard; external alert channels are not configured. This workstation must stay awake. Health does not mean ten eligible tokens, complete source coverage or permission to launch.</p>
    </>:!error&&<p role="status">Reading local operations…</p>}
  </section>;
}

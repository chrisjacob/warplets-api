import { ChevronIcon } from './NetworkIcons';
import type { NetworkManMonths } from '../../shared/network/activity';
const number = (value: number) => value.toLocaleString();
const label = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString(undefined, {month:'short',year:'numeric',timeZone:'UTC'});
export default function NetworkProgress({data}:{data:NetworkManMonths|undefined}) {
  const max = Math.max(1,...(data?.months.map(row=>row.active)??[]));
  return <section className="network-panel network-progress" aria-label="Monthly participation">
    <div className="network-panel-head"><h2>Progress, month by month</h2><span>MAN-MONTHS</span></div>
    <div className="network-months">{data?.months.map(row=><div className="network-month" key={row.month}>
      <span>{label(row.month)}{row.ongoing&&<small>Month to date</small>}</span>
      <div className="network-month-bar" role="img" aria-label={`${number(row.active)} active members; ${number(row.og)} OG, ${number(row.newMembers)} new, ${number(row.continuing)} continuing`}><i style={{width:`${row.og/max*100}%`}}/><i style={{width:`${row.newMembers/max*100}%`}}/><i style={{width:`${row.continuing/max*100}%`}}/></div>
      <strong>{number(row.active)}</strong>
    </div>)}</div>
    <div className="network-progress-legend"><span><i/>OG Members</span><span><i/>New Members</span><span><i/>Continuing Members</span></div>
    <details><summary><ChevronIcon className="network-disclosure-chevron"/>How Man-Months work</summary><p>One member active in one UTC calendar month = one Man-Month. Signing the pledge counts for the first month. Later months count once when a Farcaster post, reply, reaction, follow, or other protocol action is observed. Ordinary wallet transfers don’t count.</p><p>OG Members had a Farcaster FID of 3,354,552 or lower before the first verified pledge signature on 14 October 2026 (UTC). New Members registered after that boundary. Both are counted in the month they sign. Continuing Members are either group, active again after their signing month. Missing activity is unresolved, not confirmed churn. {data?.partial?'The total is a lower bound while activity or signing dates remain incomplete.':''}</p></details>
  </section>;
}

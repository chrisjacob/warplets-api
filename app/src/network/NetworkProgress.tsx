import { ChevronIcon } from './NetworkIcons';
import { useState } from 'react';
import { autoUpdate, flip, FloatingPortal, offset, shift, useClick, useDismiss, useFloating, useFocus, useHover, useInteractions, useRole } from '@floating-ui/react';
import type { NetworkActivityMonth, NetworkManMonths } from '../../shared/network/activity';
import './progress.css';
const number = (value: number) => value.toLocaleString();
const label = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString(undefined, {month:'short',year:'numeric',timeZone:'UTC'});
const groups = [
  { key: 'og', name: 'OG Members', color: '#64ef97' },
  { key: 'newMembers', name: 'New Members', color: '#7faee3' },
  { key: 'continuing', name: 'Continuing Members', color: '#367c51' },
] as const;
function MonthBar({row,max}:{row:NetworkActivityMonth;max:number}) {
  const [open,setOpen]=useState(false);
  const {refs,floatingStyles,context}=useFloating({open,onOpenChange:setOpen,placement:'top',whileElementsMounted:autoUpdate,middleware:[offset(8),flip({padding:8}),shift({padding:8})]});
  const hover=useHover(context,{delay:{close:60},move:false}),focus=useFocus(context),click=useClick(context),dismiss=useDismiss(context),role=useRole(context,{role:'tooltip'});
  const {getReferenceProps,getFloatingProps}=useInteractions([hover,focus,click,dismiss,role]);
  return <>
    <button ref={refs.setReference} type="button" className="network-month-bar" {...getReferenceProps({'aria-label':`${label(row.month)}: ${number(row.active)} active members; ${groups.map(group=>`${number(row[group.key])} ${group.name}`).join('; ')}`})}>
      {groups.map(group=><i key={group.key} aria-hidden="true" style={{width:`${row[group.key]/max*100}%`}}/>)}
    </button>
    {open&&<FloatingPortal root={document.getElementById('app-overlays')??undefined}>
      <div ref={refs.setFloating} style={floatingStyles} className="network-month-tooltip" {...getFloatingProps()}>
        <strong>{label(row.month)}</strong>
        <dl>{groups.map(group=><div key={group.key}><dt><i style={{background:group.color}}/>{group.name}</dt><dd>{number(row[group.key])}</dd></div>)}</dl>
      </div>
    </FloatingPortal>}
  </>;
}
export default function NetworkProgress({data}:{data:NetworkManMonths|undefined}) {
  const max = Math.max(1,...(data?.months.map(row=>row.active)??[]));
  return <section className="network-panel network-progress" aria-label="Monthly participation">
    <div className="network-panel-head"><h2>Progress, month by month</h2><span>MAN-MONTHS</span></div>
    <div className="network-months">{data?.months.map(row=><div className="network-month" key={row.month}>
      <span>{label(row.month)}{row.ongoing&&<small>Month to date</small>}</span>
      <MonthBar row={row} max={max}/>
      <strong>{number(row.active)}</strong>
    </div>)}</div>
    <div className="network-progress-legend"><span><i/>OG Members</span><span><i/>New Members</span><span><i/>Continuing Members</span></div>
    <details><summary><ChevronIcon className="network-disclosure-chevron"/>How Man-Months work</summary><p>One member active in one UTC calendar month = one Man-Month. Signing the pledge counts for the first month. Later months count once when a Farcaster post, reply, reaction, follow, or other protocol action is observed. Ordinary wallet transfers don’t count. Completed months are checked after UTC month-end; the current month is provisional.</p><p>OG Members had a Farcaster FID of 3,354,552 or lower before the first verified pledge signature on 14 October 2026 (UTC). New Members registered after that boundary. Both are counted in the month they sign. Continuing Members are either group, active again after their signing month. Missing activity is unresolved, not confirmed churn. {data?.partial?'The total is a lower bound while activity or signing dates remain incomplete.':''}</p></details>
  </section>;
}

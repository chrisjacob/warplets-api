/** Read-only local observations. Fixed refs identify checks, not passed suites or
 * authentic provider, custody, financial, physical-device or launch approvals. */
export function readinessFromMetrics(metrics){
 if(!metrics||!Number.isSafeInteger(metrics.asOfMs)||metrics.asOfMs<0||metrics.scope!=='local-fixture'||metrics.financialExecution!==false)throw new TypeError('Invalid local metrics.');
 const checks=[],add=(id,status,reason)=>checks.push(Object.freeze({id,status,reason,observedAtMs:metrics.asOfMs,evidenceRefs:Object.freeze(['local-observation:'+id])}));
 if(metrics.kind!=='ready')add('local-metrics','pending','bounded-snapshot-unavailable');
 else{
  const nat=v=>Number.isSafeInteger(v)&&v>=0,need=v=>{if(!v)throw new TypeError('Invalid local metrics.');};
  for(const [group,keys] of [['jobs',['failed','held','retry','queued','running','unassignedSourceJobs']],['evidence',['invalid','incompatible','pending','verified']],['publications',['planned','verified','held','published','finalizedBoardsWithoutPublicationReceipt']],['notices',['unknown','leased','retry','queued']]])need(metrics[group]&&keys.every(k=>nat(metrics[group][k])));
  need(metrics.staffing&&['configured','closed','paused'].every(k=>typeof metrics.staffing[k]==='boolean')&&nat(metrics.staffing.remaining));need(metrics.budget&&['ready','pending'].includes(metrics.budget.status)&&typeof metrics.budget.usageEvidenceAvailable==='boolean'&&typeof metrics.budget.costEvidenceAvailable==='boolean'&&(metrics.budget.status!=='ready'||['normal','warning','limit'].includes(metrics.budget.level)));need(metrics.recovery&&['live','restoring','ready','held'].includes(metrics.recovery.status)&&metrics.recovery.runs&&nat(metrics.recovery.runs.held)&&nat(metrics.recovery.runs.ready));
  add('local-metrics','passed','consistent-local-snapshot');const s=metrics.staffing;
  add('staffing',s.configured&&!s.closed&&!s.paused&&s.remaining>0?'passed':'pending',!s.configured?'staffing-required':s.closed?'board-closed':s.paused?'operator-pause':s.remaining===0?'staffed-capacity-exhausted':'configured-local-headroom');
  add('usage-evidence',metrics.budget.usageEvidenceAvailable?'passed':'pending',metrics.budget.usageEvidenceAvailable?'recorded-local-usage':'usage-unknown');
  add('budget',metrics.budget.status!=='ready'?'pending':metrics.budget.level==='limit'?'failed':metrics.budget.level==='warning'?'pending':metrics.budget.costEvidenceAvailable?'passed':'pending',metrics.budget.status!=='ready'?'operating-input-bound':!metrics.budget.costEvidenceAvailable?'cost-evidence-missing':'recorded-local-budget-'+metrics.budget.level);
  add('jobs',metrics.jobs.failed?'failed':metrics.jobs.held+metrics.jobs.retry+metrics.jobs.queued+metrics.jobs.running+metrics.jobs.unassignedSourceJobs?'pending':'passed',metrics.jobs.failed?'failed-job-reconciliation':metrics.jobs.held+metrics.jobs.retry?'held-job-reconciliation':'observed-local-job-state');
  add('evidence',metrics.evidence.invalid+metrics.evidence.incompatible?'failed':metrics.evidence.pending?'pending':metrics.evidence.verified?'passed':'not-applicable',metrics.evidence.invalid+metrics.evidence.incompatible?'invalid-or-incompatible-head':metrics.evidence.pending?'unresolved-evidence-head':'observed-local-heads');
  const p=metrics.publications;add('publication',p.planned+p.verified+p.held+p.finalizedBoardsWithoutPublicationReceipt?'pending':p.published?'passed':'not-applicable','observed-local-publication-state');
  add('local-notices',metrics.notices.unknown+metrics.notices.leased+metrics.notices.retry+metrics.notices.queued?'pending':'passed','observed-local-inbox-state');
  add('private-recovery',metrics.recovery.status==='held'||metrics.recovery.runs.held?'failed':metrics.recovery.status==='restoring'?'pending':metrics.recovery.runs.ready?'passed':'pending',metrics.recovery.runs.ready?'retained-local-ready-run':'no-completed-local-recovery-observation');
 }
 for(const [id,reason] of [['local-parity-suite','test-run-evidence-not-supplied'],['backup-recency','verified-backup-age-not-supplied'],['provider-provenance','production-provider-evidence-not-supplied'],['exact-external-costs','verified-cost-evidence-not-supplied'],['production-custody','custody-release-gate'],['physical-wallet','physical-device-release-gate'],['physical-staff-coverage','staff-availability-release-gate']])add(id,'pending',reason);
 return Object.freeze({format:'10x.local.readiness.v1',scope:'local-fixture',asOfMs:metrics.asOfMs,financialExecution:false,isAuthorization:false,checks:Object.freeze(checks)});
}

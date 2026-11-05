import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = name => readFileSync(resolve(root, name), 'utf8');
const plan = JSON.parse(read('tasks.json'));
const state = JSON.parse(read('RUN_STATE.json'));
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
check(plan.schemaVersion === 1 && state.schemaVersion === 1, 'Unsupported manifest/state schema');
const expectedB = Array.from({ length: 21 }, (_, i) => 'B' + String(i).padStart(2, '0'));
const expectedR = Array.from({ length: 6 }, (_, i) => 'R' + String(i + 1).padStart(2, '0'));
const expectedA = Array.from({ length: 58 }, (_, i) => 'A' + String(i + 1).padStart(2, '0'));
const records = [...plan.tasks, ...plan.releaseGates];
const byId = new Map(records.map(task => [task.id, task]));
check(byId.size === records.length, 'Duplicate task/gate ID');
check(JSON.stringify(plan.tasks.map(t => t.id)) === JSON.stringify(expectedB), 'B queue must contain B00 through B20 in ID order');
check(JSON.stringify(plan.releaseGates.map(t => t.id)) === JSON.stringify(expectedR), 'Release queue must contain R01 through R06');
const acceptance = new Set();
for (const task of records) {
  check(typeof task.title === 'string' && task.title.length > 0, task.id + ': missing title');
  check(existsSync(resolve(root, task.card)), task.id + ': missing task card ' + task.card);
  for (const dep of task.dependsOn) check(byId.has(dep) && dep !== task.id, task.id + ': invalid dependency ' + dep);
  for (const condition of task.conditionalRequirements ?? []) {
    check(typeof condition.when === 'string' && condition.when.length > 0, task.id + ': missing conditional gate trigger');
    for (const dep of condition.requires) check(byId.has(dep) && dep !== task.id, task.id + ': invalid conditional dependency ' + dep);
  }
  for (const ref of task.acceptanceRefs) {
    check(expectedA.includes(ref), task.id + ': unknown acceptance ' + ref);
    acceptance.add(ref);
  }
  if (task.phase === 'build') {
    check(task.scope === 'local-only' && task.financialExecution === false, task.id + ': build authority widened');
    check(task.dependsOn.every(dep => expectedB.includes(dep)), task.id + ': build task depends on external release gate');
  } else check(task.externalApprovalRequired === true, task.id + ': missing external approval boundary');
}
const visiting = new Set(), done = new Set();
function visit(id) {
  if (done.has(id) || !byId.has(id)) return;
  if (visiting.has(id)) { failures.push('Dependency cycle at ' + id); return; }
  visiting.add(id);
  const record = byId.get(id);
  for (const dep of [...record.dependsOn, ...(record.conditionalRequirements ?? []).flatMap(item => item.requires)]) visit(dep);
  visiting.delete(id);
  done.add(id);
}
for (const id of byId.keys()) visit(id);
for (const id of expectedA) check(acceptance.has(id), 'Missing PRD acceptance mapping: ' + id);
const trace = read('TRACEABILITY.md');
const traceIds = [...trace.matchAll(/^\| (A\d{2}) /gm)].map(match => match[1]);
check(JSON.stringify(traceIds) === JSON.stringify(expectedA), 'Traceability must contain exactly ordered A01–A58');
const profiles = plan.acceptanceProfiles;
check(profiles.core.task === 'B20' && profiles.full.task === 'B20', 'Profiles must belong to B20');
check(JSON.stringify([...profiles.core.dependsOn].sort()) === JSON.stringify(['B08', 'B09']), 'Core profile must not acquire full-product dependencies');
check(JSON.stringify([...profiles.full.dependsOn].sort()) === JSON.stringify(expectedB.slice(0, 20)), 'Full profile must cover B00–B19');
const taskStatuses = new Set(['not_started', 'in_progress', 'blocked', 'verified']);
for (const id of expectedB) {
  const current = state.tasks[id];
  check(Boolean(current), 'Missing state for ' + id);
  if (!current) continue;
  check(taskStatuses.has(current.status), id + ': invalid state');
  check(Array.isArray(current.evidence), id + ': evidence must be an array');
  if (current.status === 'verified') {
    check(current.evidence.length > 0 && /^[0-9a-f]{7,40}$/.test(current.implementationCommit ?? ''), id + ': verified requires evidence and commit');
    check(byId.get(id).dependsOn.every(dep => state.tasks[dep]?.status === 'verified'), id + ': verified before dependencies');
  }
}
check(Object.keys(state.tasks).length === expectedB.length, 'Unexpected state task ID');
for (const profile of ['core', 'full']) {
  const current = state.acceptanceProfiles[profile];
  check(current && taskStatuses.has(current.status), 'Invalid profile state: ' + profile);
  if (current?.status === 'verified') {
    check(current.evidence.length > 0 && /^[0-9a-f]{7,40}$/.test(current.commit ?? ''), profile + ': verified requires evidence and commit');
    check(profiles[profile].dependsOn.every(id => state.tasks[id]?.status === 'verified'), profile + ': verified before prerequisites');
  }
}
if (state.tasks.B20?.status === 'verified') {
  check(state.acceptanceProfiles.core.status === 'verified' && state.acceptanceProfiles.full.status === 'verified', 'B20 complete requires both profiles');
}
check(state.currentTask === null || expectedB.includes(state.currentTask), 'Invalid currentTask');
check(state.migrationAllocation.next >= 22 && state.migrationAllocation.historicalGap === 19, 'Migration allocation violates baseline');
check(existsSync(resolve(root, plan.governingSpec)), 'Missing governing PRD');
for (const id of expectedR) check(Boolean(state.releaseGates[id]), 'Missing release state: ' + id);

function markdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? markdownFiles(path) : entry.name.endsWith('.md') ? [path] : [];
  });
}
let links = 0;
for (const file of markdownFiles(root)) {
  const body = readFileSync(file, 'utf8');
  for (const match of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = match[1].trim().replace(/^<|>$/g, '');
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target) || target.startsWith('#') || target.startsWith('mailto:')) continue;
    target = decodeURIComponent(target.split('#')[0]).replace(/:\d+$/, '');
    if (!target) continue;
    links++;
    check(!isAbsolute(target) && !/^[A-Za-z]:/.test(target), relative(root, file) + ': nonportable absolute link ' + target);
    check(existsSync(resolve(dirname(file), target)), relative(root, file) + ': broken local link ' + target);
  }
}
function readyTasks(current) {
  const verified = id => current.tasks[id]?.status === 'verified';
  const ready = [];
  for (const task of plan.tasks) {
    const status = current.tasks[task.id]?.status;
    if (status === 'verified' || status === 'blocked') continue;
    if (task.id === 'B20') {
      const profile = current.acceptanceProfiles.core.status === 'verified' ? 'full' : 'core';
      if (current.acceptanceProfiles[profile].status === 'blocked' || current.acceptanceProfiles[profile].status === 'verified') continue;
      if (plan.acceptanceProfiles[profile].dependsOn.every(verified)) ready.push({ ...task, profile, status });
    } else if (task.dependsOn.every(verified)) ready.push({ ...task, status });
  }
  return ready.sort((a, b) => {
    const aResume = a.id === current.currentTask ? -1 : 0;
    const bResume = b.id === current.currentTask ? -1 : 0;
    return aResume - bResume || a.priority - b.priority || a.id.localeCompare(b.id);
  });
}

if (process.argv.includes('--self-check')) {
  const sample = structuredClone(state);
  sample.currentTask = null;
  for (const task of Object.values(sample.tasks)) task.status = 'not_started';
  for (const profile of Object.values(sample.acceptanceProfiles)) profile.status = 'not_started';
  assert.deepEqual(readyTasks(sample).map(task => task.id), ['B00']);
  for (let index = 0; index <= 9; index++) sample.tasks['B' + String(index).padStart(2, '0')].status = 'verified';
  assert.equal(readyTasks(sample)[0].id, 'B20');
  assert.equal(readyTasks(sample)[0].profile, 'core');
  sample.tasks.B20.status = 'in_progress';
  sample.currentTask = 'B20';
  sample.acceptanceProfiles.core.status = 'verified';
  assert.equal(readyTasks(sample).some(task => task.id === 'B20'), false);
  for (let index = 10; index < 20; index++) sample.tasks['B' + String(index).padStart(2, '0')].status = 'verified';
  assert.equal(readyTasks(sample)[0].profile, 'full');
  sample.acceptanceProfiles.full.status = 'verified';
  sample.tasks.B20.status = 'verified';
  assert.deepEqual(readyTasks(sample), []);
}

if (failures.length) {
  for (const error of failures) process.stderr.write('- ' + error + '\n');
  process.exitCode = 1;
} else {
  process.stdout.write('Blueprint valid: 21 B tasks, 6 release gates, 58 acceptance cases, acyclic dependencies, valid run state, ' + links + ' local links.\n');
  if (process.argv.includes('--self-check')) process.stdout.write('Queue checks passed: fresh start, core readiness, no repeated core loop, full readiness, completion.\n');
  if (process.argv.includes('--next')) {
    process.stdout.write(JSON.stringify({
      runId: state.runId,
      currentTask: state.currentTask,
      ready: readyTasks(state).slice(0, 6).map(({ id, title, card, profile, lane, status }) => ({ id, title, card, profile, lane, status })),
      blocked: plan.tasks.filter(task => state.tasks[task.id]?.status === 'blocked').map(task => ({ id: task.id, blocker: state.tasks[task.id].blocker })),
      releaseWorkAuthorized: false
    }, null, 2) + '\n');
  }
}

import { createHash } from 'node:crypto';
import { allocationWindow, distributeBudget } from '../domain/earn/index.mjs';
import { decimal, name, nat, requireValue } from './checks.mjs';

export const FORMAT='10x.local.earn.public.v1';
function canonical(value) {
  if (value===null || typeof value==='string' || typeof value==='boolean' || Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if (value && typeof value==='object') {
    return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  }
  throw new TypeError('Portable manifests accept JSON strings and safe integers only.');
}
export function commitment(type,value) {
  return createHash('sha256').update(canonical([FORMAT,type,value])).digest('hex');
}
function hash(value,label) { requireValue(typeof value==='string' && /^[a-f0-9]{64}$/.test(value),'Invalid '+label+' digest.'); }
function exactKeys(value,keys,label) {
  requireValue(value && typeof value==='object' && !Array.isArray(value)
    && Object.keys(value).length===keys.length && keys.every(k=>Object.hasOwn(value,k)),`Invalid ${label} fields.`);
}
function compare(a,b) { return a<b?-1:a>b?1:0; }

function leaves(context,awards) {
  // Ordering does not depend on insertion order or the locale of a recovering browser.
  return [...awards].sort((a,b)=>compare(a.wallet,b.wallet)).map(a=>({award:a,hash:commitment('award',[context,a])}));
}
function treeLayer(nodes) {
  const next=[];
  for (let i=0;i<nodes.length;i+=2) next.push(i+1===nodes.length?nodes[i]:commitment('pair',[nodes[i],nodes[i+1]]));
  return next;
}
export function allocationContext(a) {
  return {boardId:a.boardId,tokenId:a.tokenId,day:a.day,vestsFromMs:a.vestsFromMs,vestsThroughMs:a.vestsThroughMs};
}
export function awardRoot(context,awards) {
  let nodes=leaves(context,awards).map(x=>x.hash);
  if (!nodes.length) return commitment('empty',context);
  while (nodes.length>1) nodes=treeLayer(nodes);
  return nodes[0];
}
export function makeAwardProof(allocation,wallet) {
  const context=allocationContext(allocation), sorted=leaves(context,allocation.awards);
  let index=sorted.findIndex(x=>x.award.wallet===wallet);
  if (index<0) return null;
  const award=sorted[index].award, path=[];
  let nodes=sorted.map(x=>x.hash);
  while (nodes.length>1) {
    const sibling=index%2===0?index+1:index-1;
    if (sibling<nodes.length) path.push({side:sibling<index?'left':'right',hash:nodes[sibling]});
    index=Math.floor(index/2); nodes=treeLayer(nodes);
  }
  return {format:FORMAT,context,award,path,root:nodes[0]};
}
export function verifyAwardProof(proof,expectedRoot) {
  hash(expectedRoot,'pinned root');
  requireValue(proof?.format===FORMAT && Array.isArray(proof.path) && proof.path.length<=7,'Invalid award proof.');
  let current=commitment('award',[proof.context,proof.award]);
  for (const step of proof.path) {
    hash(step.hash,'sibling');
    requireValue(step.side==='left'||step.side==='right','Invalid proof side.');
    current=commitment('pair',step.side==='left'?[step.hash,current]:[current,step.hash]);
  }
  return current===expectedRoot && proof.root===expectedRoot;
}

const winnerKeys=['userId','wallet','submissionId','tokenId','submittedAtMs','contentScore','multiplierTenths','pointsTenths'];
function verifyBoard(board) {
  exactKeys(board,['epoch','finalizedAtMs','snapshotId','winners'],'board');
  nat(board.epoch,'epoch');nat(board.finalizedAtMs,'finalization');hash(board.snapshotId,'snapshot');
  const t=board.epoch*86_400_000;
  requireValue(board.finalizedAtMs>=t+86_400_000,'Board finalized before close.');
  requireValue(Array.isArray(board.winners)&&board.winners.length<=100,'Invalid winner count.');
  const wallets=new Set(),users=new Set(),ids=new Set();
  let previous;
  for (const w of board.winners) {
    exactKeys(w,winnerKeys,'winner');
    for (const k of ['userId','wallet','submissionId','tokenId']) name(w[k],k);
    requireValue(!wallets.has(w.wallet)&&!users.has(w.userId)&&!ids.has(w.submissionId),'Duplicate winner.');
    wallets.add(w.wallet);users.add(w.userId);ids.add(w.submissionId);
    nat(w.submittedAtMs,'submitted');nat(w.contentScore,'content score');nat(w.multiplierTenths,'multiplier');
    requireValue(w.submittedAtMs>=t&&w.submittedAtMs<t+86_400_000&&w.contentScore>0&&w.contentScore<=10
      &&w.multiplierTenths>0&&w.multiplierTenths<=100&&w.pointsTenths===w.contentScore*w.multiplierTenths,'Invalid ranked score.');
    if (previous) {
      const order=previous.pointsTenths-w.pointsTenths || previous.contentScore-w.contentScore
        || w.submittedAtMs-previous.submittedAtMs || compare(w.submissionId,previous.submissionId);
      requireValue(order>=0,'Incorrect winner ordering.');
    }
    previous=w;
  }
}
const allocationKeys=['boardId','tokenId','day','activationMs','originalUnits','startsAtMs','vestsFromMs','vestsThroughMs',
  'budgetUnits','burnUnits','awards','awardRoot'];
export function verifyManifest(manifest,expectedDigest) {
  hash(expectedDigest,'pinned manifest');
  exactKeys(manifest,['format','board','boardId','allocations'],'manifest');
  requireValue(manifest.format===FORMAT,'Unsupported manifest.');
  requireValue(commitment('manifest',manifest)===expectedDigest,'Manifest differs from the pinned digest.');
  verifyBoard(manifest.board);
  const boardId=commitment('board',manifest.board);
  requireValue(manifest.boardId===boardId,'Board commitment mismatch.');
  requireValue(Array.isArray(manifest.allocations)&&manifest.allocations.length<=32,'Invalid allocation count.');
  let previousToken;
  for (const allocation of manifest.allocations) {
    exactKeys(allocation,allocationKeys,'allocation');
    const a=allocation;
    name(a.tokenId,'token');nat(a.activationMs,'activation');
    requireValue(!previousToken || compare(previousToken,a.tokenId)<0,'Duplicate or unordered token allocation.');
    previousToken=a.tokenId;
    const supply=decimal(a.originalUnits,'supply');
    const budget=decimal(a.budgetUnits,'budget');
    requireValue(supply>0n&&budget*100n===supply&&a.boardId===boardId,'Incorrect original supply or board reference.');
    const window=allocationWindow(a.activationMs,a.day);
    requireValue(window.boardEpoch===manifest.board.epoch&&window.startsAtMs===a.startsAtMs&&window.vestsFromMs===a.vestsFromMs
      &&window.vestsThroughMs===a.vestsThroughMs,'Allocation schedule mismatch.');
    const computed=distributeBudget(budget,manifest.board.winners);
    requireValue(String(computed.burnUnits)===a.burnUnits,'Burn does not reconcile.');
    const awards=computed.awards.map(x=>({wallet:x.wallet,amountUnits:String(x.amountUnits)}));
    requireValue(canonical(awards)===canonical(a.awards),'Awards differ from capped point shares.');
    requireValue(awardRoot(allocationContext(a),awards)===a.awardRoot,'Award Merkle root mismatch.');
  }
  return {format:FORMAT,boardId,epoch:manifest.board.epoch,allocations:manifest.allocations.length,manifestDigest:expectedDigest};
}

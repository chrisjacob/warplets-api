import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { openDatabase } from '../storage/database.mjs';
import { exportBoard, importBoard } from './archive.mjs';
import { verifyManifest, verifyAwardProof } from './commitments.mjs';

function readFile(path) {
  if (statSync(path).size>4*1024*1024) throw new RangeError('Archive file exceeds the 4 MiB pilot limit.');
  return JSON.parse(readFileSync(path,'utf8'));
}
export function runArchive(argv) {
  const [command,...args]=argv;
  if (command==='verify' && args.length===2) return verifyManifest(readFile(args[0]).manifest,args[1]);
  if (command==='verify-proof' && args.length===2) {
    if (!verifyAwardProof(readFile(args[0]).proof,args[1])) throw new Error('Proof does not match the pinned root.');
    return {verified:true};
  }
  if (['export','restore'].includes(command) && args.length===3) {
    const db=openDatabase(args[0]);
    try {
      if (command==='restore') return importBoard(db,readFile(args[1]).manifest,args[2]);
      if (!/^\d{1,8}$/.test(args[1])) throw new Error('Supply a non-negative UTC epoch number.');
      const bundle=exportBoard(db,Number(args[1]));
      writeFileSync(args[2],JSON.stringify(bundle,null,2)+'\n',{flag:'wx'});
      return {file:args[2],sha256:bundle.sha256,boardId:bundle.manifest.boardId};
    } finally { db.close(); }
  }
  throw new Error('Use export DB EPOCH FILE, verify FILE PINNED_SHA256, restore RECOVERY_DB FILE PINNED_SHA256, or verify-proof FILE PINNED_ROOT.');
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(runArchive(process.argv.slice(2)),null,2)); }
  catch(error) { console.error(error.message);process.exitCode=1; }
}

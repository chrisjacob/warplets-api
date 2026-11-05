import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openDatabase} from '../storage/database.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {nodeArtifactStore} from '../artifacts/node.mjs';
import {recoveryFixture} from './fixtures.mjs';
import {createPublicRecovery,createPrivateRecovery} from './restore.mjs';
import {readPublicRecoveredClaims} from './reconcile.mjs';
import {canonicalJson} from '../security/canonical.mjs';
import {persistObject} from './inventory.mjs';

// This command intentionally accepts no operational database, bucket, account,
// target path or credentials. Every database and artifact is a disposable fixture.
export async function runRecoveryRehearsal(){
 const began=performance.now(),folder=await mkdtemp(join(tmpdir(),'tenx-b08-recovery-')),source=await recoveryFixture();let publicDb,privateDb,sourceClosed=false;
 try{
  const publicSnapshot=await source.exporter.capturePublic(),privateSnapshot=await source.exporter.capturePrivate();assert.equal(publicSnapshot.kind,'captured');assert.equal(privateSnapshot.kind,'captured');
  const backup=nodeArtifactStore(join(folder,'backup')),pins=join(folder,'independent-pins');await mkdir(pins);
  for(const [mode,snapshot] of [['public',publicSnapshot],['private',privateSnapshot]]){
   await writeFile(join(folder,mode+'-inventory.json'),snapshot.bytes,{flag:'wx'});
   // Expected roots are recorded separately before the source is lost. Restore
   // must use these roots; damaged files cannot manufacture their own authority.
   await writeFile(join(pins,mode+'.sha256'),snapshot.digest+'\n',{flag:'wx'});
   for(const identity of snapshot.inventory.objects)assert.equal((await persistObject(backup,identity,source.objects.get(identity.key),source.crypto)).kind,'verified');
  }
  source.db.close();sourceClosed=true;
  const input=async mode=>({inventory:JSON.parse(await readFile(join(folder,mode+'-inventory.json'),'utf8')),pinnedDigest:(await readFile(join(pins,mode+'.sha256'),'utf8')).trim()});
  publicDb=openDatabase(join(folder,'public-recovery.sqlite'));privateDb=openDatabase(join(folder,'private-recovery.sqlite'));
  const publicDriver=createNodeAtomicDriver(publicDb),privateDriver=createNodeAtomicDriver(privateDb);
  const publicResult=await createPublicRecovery({...source,driver:publicDriver,sourceArtifacts:backup,artifacts:nodeArtifactStore(join(folder,'public-restored'))}).restore(await input('public'));
  const privateResult=await createPrivateRecovery({...source,driver:privateDriver,sourceArtifacts:backup,artifacts:nodeArtifactStore(join(folder,'private-restored'))}).restore(await input('private'));
  assert.equal(publicResult.kind,'restored',canonicalJson(publicResult));assert.equal(privateResult.kind,'restored',canonicalJson(privateResult));
  const claims=await readPublicRecoveredClaims(publicDriver,{wallet:'w1',nowMs:source.golden.start+10*365*86400000});assert.equal(claims.items.length,1);assert.equal(claims.items[0].vestedUnits,claims.items[0].awardUnits);
  assert.equal(publicDb.prepare('SELECT COUNT(*) n FROM earn_submissions').get().n,0);assert.equal(privateDb.prepare('SELECT COUNT(*) n FROM sessions').get().n,0);
  return {mode:'synthetic-recovery-rehearsal',sourceCommit:'synthetic-zero-fixture',sourceDatabaseLost:true,independentPinsRetained:true,
   publicRecovery:publicResult.report,privateRecovery:privateResult.report,yearsLaterClaimsPreserved:true,elapsedMs:Math.round(performance.now()-began),financialExecution:false,remoteCalls:0};
 }finally{publicDb?.close();privateDb?.close();if(!sourceClosed)source.db.close();await rm(folder,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{if(process.argv.length!==3||process.argv[2]!=='--fixture-rehearsal')throw Error('Use --fixture-rehearsal; operational recovery is not exposed by this local CLI.');console.log(JSON.stringify(await runRecoveryRehearsal(),null,2));}
 catch(error){console.error(error.message);process.exitCode=1;}
}

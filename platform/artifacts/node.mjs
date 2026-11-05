import { mkdir,open,link,unlink,realpath,lstat } from 'node:fs/promises';
import { resolve,join,dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ArtifactConflictError,artifactIdentity,prepareArtifact,verifiedBytes } from './identity.mjs';

/** Local immutable storage. Staging uses wx; hard-link publication is atomic
 * and fails if the immutable target already exists. A crash may retain a .pending
 * file or an unlisted final object; neither is publicly served or overwritten. */
export function nodeArtifactStore(root){
  const base=resolve(root);
  async function location(identity){
    const directory=join(base,identity.visibility);
    await mkdir(directory,{recursive:true,mode:0o700});
    const actual=await realpath(directory),parent=await realpath(dirname(directory));
    if(actual!==join(parent,identity.visibility))throw new Error('Artifact directory cannot be a symbolic link.');
    return join(directory,identity.key.slice(identity.visibility.length+1));
  }
  async function getVerified(input){
    const identity=artifactIdentity(input),path=await location(identity);
    let file;
    try{
      const info=await lstat(path);
      if(!info.isFile() || info.isSymbolicLink())return {status:'conflict',identity,reason:'not a regular artifact file'};
      if(info.size!==identity.size)return {status:'conflict',identity,reason:'size mismatch'};
      file=await open(path,'r');
      const bytes=new Uint8Array(identity.size+1);
      let total=0;
      while(total<bytes.length){
        const {bytesRead}=await file.read(bytes,total,bytes.length-total,total);
        if(!bytesRead)break;
        total+=bytesRead;
      }
      return await verifiedBytes(identity,bytes.slice(0,total));
    }catch(error){if(error.code==='ENOENT')return {status:'missing',identity};throw error;}
    finally{await file?.close();}
  }
  async function putIfAbsent(input,value){
    const {identity,bytes}=await prepareArtifact(input,value);
    const path=await location(identity),temporary=path+'.pending-'+randomUUID();
    let stage;
    try{
      stage=await open(temporary,'wx',0o600);
      await stage.writeFile(bytes);await stage.sync();await stage.close();stage=undefined;
      try{await link(temporary,path);}
      catch(error){
        if(error.code!=='EEXIST')throw error;
        const existing=await getVerified(identity);
        if(existing.status==='conflict')throw new ArtifactConflictError(existing.reason);
        if(existing.status!=='verified')return {status:'unknown',identity};
        return {status:'exists',identity};
      }
      const stored=await getVerified(identity);
      if(stored.status==='conflict')throw new ArtifactConflictError(stored.reason);
      return {status:stored.status==='verified'?'created':'unknown',identity};
    }catch(error){
      if(error instanceof ArtifactConflictError)throw error;
      return {status:'unknown',identity};
    }finally{
      await stage?.close().catch(()=>{});
      // Only this invocation's exclusive staging name is eligible for cleanup.
      // If cleanup fails, leave it private for bounded operator reconciliation.
      await unlink(temporary).catch(()=>{});
    }
  }
  return Object.freeze({putIfAbsent,getVerified});
}

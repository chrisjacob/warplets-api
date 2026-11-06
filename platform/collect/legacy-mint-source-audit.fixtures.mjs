import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {mintSourceFixture} from './legacy-mint-source.fixtures.mjs';
import {nodeArtifactStore} from '../artifacts/node.mjs';
import {privateIdentity} from '../artifacts/identity.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {createLegacyMintSourceAudit} from './legacy-mint-source-audit.mjs';
export async function mintSourceAuditFixture(t,options={}){
 const f=await mintSourceFixture(t,options),directory=await mkdtemp(join(tmpdir(),'synthetic-mint-source-audit-'));t.after(()=>rm(directory,{recursive:true,force:true}));const artifacts=nodeArtifactStore(directory),objects=new Map();
 const retainBytes=async bytes=>{const byteDigest=await f.crypto.sha256(bytes),identity=privateIdentity({key:'private/'+byteDigest+'.json',byteDigest,size:bytes.length,semanticDigest:null,visibility:'private',contentType:'application/json'});await artifacts.putIfAbsent(identity,bytes);objects.set(identity.key,{identity,bytes});return identity;},retain=async value=>retainBytes(utf8(canonicalJson(value))),references=[];
 if(options.configured){for(const bytes of f.parts.values())await retainBytes(bytes);const policy=await retain({format:'legacy-mint-original-policy-v1',...f.input().configured.policy});for(const _ of f.original)references.push({kind:'configured',policy});}else for(const fixture of f.original)references.push({kind:'manual',fixture:await retain(fixture)});
 const ports={driver:f.driver,crypto:f.crypto,artifacts,createDigest:f.ports.createDigest,beaconVerifier:f.ports.beaconVerifier},request=(index=0,prefix=null)=>{const original=f.input(index,prefix);return {rootId:f.bundle.root.id,source:f.source(),prefix:original.prefix,asOfMs:original.asOfMs,original:references[index]};};
 return {...f,directory,objects,artifacts,references,retain,retainBytes,auditPorts:ports,auditRequest:request,auditor:createLegacyMintSourceAudit(ports)};
}

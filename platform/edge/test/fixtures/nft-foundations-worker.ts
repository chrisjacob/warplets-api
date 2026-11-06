// Private fixture: no storage, providers, Node compatibility or public route.
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {metadataFromCollect} from '../../../nfts/metadata-schema.mjs';
import {metadataPermissionDossier,inspectGenesisImageProposal} from '../../../nfts/permissions.mjs';
import {createRefreshWorkflow} from '../../../nfts/refresh-workflow.mjs';
export default {async fetch(request:Request){const body=await request.json() as any,base=createWebCrypto();let hashes=0,accessorInvoked=false;const inputBytes=new TextEncoder().encode(JSON.stringify(body)).length;
 if(body.fault==='accessor')Object.defineProperty(body.value,'referenceDigest',{enumerable:true,get(){accessorInvoked=true;return 'a'.repeat(64);}});
 const service=createRefreshWorkflow({crypto:{...base,async sha256(bytes:Uint8Array){hashes++;if(body.fault==='mutation'){body.value.referenceDigest='9'.repeat(64);body.value.metadata.asset.level=10;}return base.sha256(bytes);}}});
 try{let result;switch(body.method){case 'metadata':result=metadataFromCollect(body.value);break;case 'dossier':result=metadataPermissionDossier(body.value);break;case 'image':result=inspectGenesisImageProposal(body.value);break;case 'create':result=await service.create(body.value);break;case 'advance':result=await service.advance(body.state,body.event,body.current);break;case 'restore':result=await service.restore(body.state);break;default:throw Error('Unknown private fixture method');}return Response.json({result,metrics:{hashes,inputBytes,outputBytes:new TextEncoder().encode(JSON.stringify(result)).length,accessorInvoked}});}catch(error){return Response.json({error:(error as Error).message,metrics:{hashes,inputBytes,outputBytes:0,accessorInvoked}});}
}};

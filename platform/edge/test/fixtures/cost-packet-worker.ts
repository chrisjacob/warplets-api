import {createCostPacketService} from '../../../costs/packet-service.mjs';
import type {CostPacketInput} from '../../../costs/packet-service.mjs';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
export default {async fetch(request:Request){const body=await request.json() as {input:CostPacketInput;fault?:string},crypto=createWebCrypto();let hashes=0;
 const service=createCostPacketService({crypto:{async sha256(bytes:Uint8Array){hashes++;if(body.fault==='mutation'){(body.input as any).context.fundingStateHash='changed-during-await';(body.input as any).quotes.mintRent.amount='999';}return crypto.sha256(bytes);}}});
 try{const result=await service.calculate(body.input);return Response.json({result,metrics:{hashes,inputBytes:new TextEncoder().encode(JSON.stringify(body.input)).length,outputBytes:new TextEncoder().encode(JSON.stringify(result)).length}});}catch(error){return Response.json({error:(error as Error).message,hashes});}
}};

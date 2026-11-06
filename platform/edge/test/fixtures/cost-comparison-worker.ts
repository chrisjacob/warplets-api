import {createCostPacketService} from '../../../costs/packet-service.mjs';
import {calculateCostComparisons} from '../../../costs/packet-core.mjs';
import {scenarioCashflow} from '../../../costs/scenario-cashflow.mjs';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
export default {async fetch(request:Request){const body=await request.json() as any;
 const packet=await createCostPacketService({crypto:createWebCrypto()}).calculate(body.input);
 const comparisons=calculateCostComparisons(body.input,packet.executionContextId,body.options);
 return Response.json({comparisons,cashflow:scenarioCashflow(comparisons.oneClaim)});
}};

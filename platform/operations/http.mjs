import { failure, json } from '../server/api.mjs';
import { controlledScopes, protectedScopes, actionDecision } from './controls.mjs';

export const operationsPaths={'/operations/status':{get:{operationId:'getLocalOperationStatus',
  summary:'Read the local application scope, admission and optional-work statuses.',
  responses:{200:{description:'Local scope decisions. Claims, principal and recovery are protected.'}}}}};
export function handleOperations(db,request,now) {
  const {pathname}=new URL(request.url);
  if(pathname==='/api/v1/operations/status') {
    if(request.method!=='GET')return failure(405,'method_not_allowed','Use GET.',{allow:'GET'});
    return json({mode:'local-fixture',boundary:'application-only',scopes:controlledScopes.map(s=>actionDecision(db,s,now)),protectedScopes});
  }
  if(pathname==='/api/v1/launch-plans/preview'&&request.method==='POST') {
    const decision=actionDecision(db,'launch-preparation',now);
    if(!decision.allowed)return failure(503,'scope_unavailable','New launch preparation is temporarily held: '+decision.reason+'.',{'retry-after':'60'});
  }
  return null;
}

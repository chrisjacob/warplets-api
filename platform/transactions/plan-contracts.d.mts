import type {CanonicalCrypto,Principal} from '../application/ports';
import type {ActionKind,ActionRequestV1,BoundActionRequestV1,ActionEvidenceRequirement,UnsupportedActionPlan} from '../application/action-plans';
export type {ActionKind,ActionRequestV1,BoundActionRequestV1,ActionEvidenceRequirement,UnsupportedActionPlan} from '../application/action-plans';
export const ACTION_REQUEST_FORMAT:'10x.action-request.v1';
export const ACTION_REQUEST_LIMITS:Readonly<{requestBytes:2048;outputBytes:4096;idCharacters:128}>;
export const ACTION_KINDS:readonly ActionKind[];
export const ACTION_EVIDENCE_REQUIREMENTS:readonly ActionEvidenceRequirement[];
export class ActionPlanInputError extends TypeError {readonly code:'invalid-action-request'}
export function normalizeActionRequest(value:unknown):ActionRequestV1;
export function bindActionRequest(value:Readonly<{principal:Principal;request:ActionRequestV1}>,crypto:CanonicalCrypto):Promise<BoundActionRequestV1>;
export function actionRequirements(value:ActionRequestV1):readonly ActionEvidenceRequirement[];
export function unsupportedActionPlan(value:ActionRequestV1):UnsupportedActionPlan;

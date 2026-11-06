export const LEGACY_HASH_IMPLEMENTATION_PIN:string;
export const LEGACY_HASH_LIMITS:Readonly<{sourceBytes:33554432;chunkBytes:65536;stateBytes:1024}>;
export interface LegacyAuditHashState {readonly format:'10x.local.legacy-audit-sha256.v1';readonly algorithm:'SHA-256';readonly implementationPin:string;readonly bytes:number;readonly words:readonly number[];readonly tailHex:string}
export interface PinnedSha256State {blockLen:number;outputLen:number;padOffset:number;isLE:boolean;finished:boolean;destroyed:boolean;length:number;pos:number;buffer:Uint8Array;get():number[];set(...words:number[]):void;update(bytes:Uint8Array):unknown;digest():Uint8Array;destroy():void}
export function validateLegacyAuditHashState(value:unknown):LegacyAuditHashState;
export function createLegacyAuditHashAdapter(ports:{createSha256:()=>PinnedSha256State;implementationPin:string}):Readonly<{initial():LegacyAuditHashState;advance(state:LegacyAuditHashState,bytes:Uint8Array):LegacyAuditHashState;finish(state:LegacyAuditHashState):string}>;

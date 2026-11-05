export class FinancialReadError extends Error {constructor(code:string,message:string,status?:number);readonly code:string;readonly status:number;}
export const READ_CURSOR_MAX_AGE_MS:300000;
export function requireRead(value:unknown,code:string,message:string,status?:number):asserts value;
export function decodeReadCursor(value:unknown,context:{scope:string;subject:string;nowMs:number}):{after:string;evaluatedAtMs:number;sourceRevision:string|null};
export function encodeReadCursor(context:{scope:string;subject:string;sourceRevision:string;evaluatedAtMs:number;after:string}):string;

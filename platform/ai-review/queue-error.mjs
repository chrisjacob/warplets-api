// Shared by Node and Worker HTTP adapters. No runtime-specific imports.
export class ReviewQueueError extends Error {
 constructor(status,code,message){super(message);this.status=status;this.code=code;}
}

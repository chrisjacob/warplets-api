export interface SupportedPost {source:'farcaster'|'x';id:string;username:string|null;canonicalUrl:string}
export function supportedPost(value:unknown):SupportedPost;

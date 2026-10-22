import { timingSafeEqual } from "node:crypto";
import { boundedJson, SourceError } from "./rpc";

export const LOCAL_ORIGINS = new Set(["https://app-local.10x.meme", "http://localhost:5183", "http://127.0.0.1:5183", "http://localhost:8794", "http://127.0.0.1:8794"]);
export const API_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cross-origin-resource-policy": "same-origin", "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'" };
export class RequestSecurityError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export function authorized(request: Request, token: string): boolean {
  // A bare credential is not a Bearer authorization header. Reject combined
  // headers and other schemes; compare the credential itself in constant time.
  const match = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9._~+/-]+=*)$/i);
  if (!match || match[1].length > 1024) return false;
  const expected = new TextEncoder().encode(token), supplied = new TextEncoder().encode(match[1]);
  return expected.length >= 32 && expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
export function requireAdminBrowser(request: Request) {
  const origin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
  if (origin !== null && !LOCAL_ORIGINS.has(origin)) throw new RequestSecurityError("origin_not_allowed", 403);
  if (site !== null && site !== "same-origin" && site !== "none") throw new RequestSecurityError("admin_cross_site_request", 403);
  // Headerless local CLI/timer calls remain valid with their Bearer token.
}
export function requireLocalReadBrowser(request: Request) {
  const origin=request.headers.get("origin"),site=request.headers.get("sec-fetch-site");
  if(origin!==null&&!LOCAL_ORIGINS.has(origin))throw new RequestSecurityError("origin_not_allowed",403);
  // Resource embeds can send GET without Origin. Reject foreign browser work
  // before any database access, while retaining local CLI and trusted previews.
  if(site!==null&&!["same-origin","none"].includes(site)&&!(["same-site","cross-site"].includes(site)&&origin!==null&&LOCAL_ORIGINS.has(origin)))throw new RequestSecurityError("local_cross_site_request",403);
}
export async function adminJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new RequestSecurityError("json_required", 415);
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d{1,10}$/.test(length) || Number(length) > 32000)) throw new RequestSecurityError("request_body_too_large", 413);
  try { return await boundedJson(new Response(request.body), 32000); }
  catch (error) {
    if (error instanceof SourceError && error.code === "response_too_large") throw new RequestSecurityError("request_body_too_large", 413);
    if (error instanceof SourceError && error.code === "response_fragment_limit") throw new RequestSecurityError("request_body_too_fragmented", 413);
    if (error instanceof SourceError && error.code === "response_timeout") throw new RequestSecurityError("request_body_timeout", 408);
    if (error instanceof SourceError && ["empty_response", "invalid_json"].includes(error.code)) throw new RequestSecurityError("invalid_request_json", 400);
    throw error;
  }
}

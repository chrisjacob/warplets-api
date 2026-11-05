import { securityHeaders } from "../shared/securityHeaders";
export type Database = Pick<D1Database, "prepare" | "batch">;
export async function one<T>(
  db: Database,
  sql: string,
  ...args: unknown[]
): Promise<T | null> {
  return db
    .prepare(sql)
    .bind(...args)
    .first<T>();
}
export async function rows<T>(
  db: Database,
  sql: string,
  ...args: unknown[]
): Promise<T[]> {
  return (
    await db
      .prepare(sql)
      .bind(...args)
      .all<T>()
  ).results;
}
export async function run(db: Database, sql: string, ...args: unknown[]) {
  return db
    .prepare(sql)
    .bind(...args)
    .run();
}
export class Problem extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function requireThat(
  value: unknown,
  status: number,
  message: string,
): asserts value {
  if (!value) throw new Problem(status, message);
}
export const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(body, {
    status,
    headers: {
      ...securityHeaders,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow",
      ...Object.fromEntries(new Headers(headers)),
    },
  });
export async function payload(
  request: Request,
  keys: string[],
  maxBytes = 65536,
) {
  requireThat(
    request.headers.get("content-type")?.split(";")[0] === "application/json",
    415,
    "JSON required",
  );
  requireThat(request.body, 400, "Body required");
  const reader = request.body.getReader();
  let raw = "",
    size = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Problem(413, "Body too large");
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Problem(400, "Invalid JSON");
  }
  requireThat(
    value && typeof value === "object" && !Array.isArray(value),
    400,
    "Object required",
  );
  const object = value as Record<string, unknown>;
  requireThat(
    Object.keys(object).every((k) => keys.includes(k)),
    400,
    "Unexpected fields",
  );
  return object;
}
export const sha = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
export const random = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
export function text(value: unknown, name: string, max = 256): string {
  requireThat(
    typeof value === "string" && value.length > 0 && value.length <= max,
    400,
    `Invalid ${name}`,
  );
  return value;
}
export function integer(
  value: unknown,
  name: string,
  min = 1,
  max = Number.MAX_SAFE_INTEGER,
) {
  requireThat(
    typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= min &&
      value <= max,
    400,
    `Invalid ${name}`,
  );
  return value;
}

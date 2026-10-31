import {
  jsonSecure,
  requireAdminScope,
  readJsonBodyWithLimit,
  type SecurityEnv,
} from "../../../_lib/security";
import type {
  MemeAdminBinding,
  AdminQuery,
  AdminCommand,
} from "../../../../../meme/src/shared/adminContracts";
import { commandScope } from "../../../../../meme/src/shared/adminContracts";
import { adminCapabilities } from "../../../_lib/memeAdminAuth";
interface AdminEnv extends SecurityEnv {
  MEME_ADMIN?: MemeAdminBinding;
}
export const onRequest: PagesFunction<AdminEnv> = async (context) => {
  const request = context.request,
    url = new URL(request.url),
    part = url.pathname.slice("/api/admin/meme/".length);
  if (
    !["overview", "performance", "comms", "health", "commands"].includes(part)
  )
    return jsonSecure({ error: "Unknown admin route" }, { status: 404 });
  if (
    !["GET", "POST"].includes(request.method) ||
    (part === "commands" && request.method !== "POST") ||
    (part !== "commands" && request.method !== "GET")
  )
    return jsonSecure({ error: "Method not allowed" }, { status: 405 });
  let command: AdminCommand | undefined,
    scope = "meme:read";
  if (request.method === "POST") {
    if (
      request.headers.get("origin") !== url.origin ||
      (request.headers.get("sec-fetch-site") &&
        !["same-origin", "none"].includes(
          request.headers.get("sec-fetch-site")!,
        ))
    )
      return jsonSecure({ error: "Origin mismatch" }, { status: 403 });
    const parsed = await readJsonBodyWithLimit<AdminCommand>(request, 65536);
    if (!parsed.ok) return parsed.response;
    command = parsed.value;
    if (
      !command ||
      typeof command !== "object" ||
      Array.isArray(command) ||
      Object.keys(command).some(
        (k) =>
          !["id", "action", "expectedVersion", "reason", "payload"].includes(k),
      )
    )
      return jsonSecure({ error: "Invalid admin command" }, { status: 400 });
    const selected = commandScope(command.action);
    if (!selected)
      return jsonSecure({ error: "Unknown command" }, { status: 400 });
    scope = selected;
  }
  const auth = await requireAdminScope(context, { scope });
  if (!auth.ok) return auth.response;
  if (!context.env.MEME_ADMIN)
    return jsonSecure(
      { error: "Launchpad admin service is not connected", configured: false },
      { status: 503 },
    );
  try {
    const capabilities = adminCapabilities(context.env, request, auth.keyId),
      actor = { id: auth.keyId, scopes: capabilities };
    const result = command
      ? await context.env.MEME_ADMIN.command(command, actor)
      : await context.env.MEME_ADMIN.read(
          {
            section: part as AdminQuery["section"],
            ...(url.searchParams.has("date")
              ? { date: url.searchParams.get("date")! }
              : {}),
            ...(url.searchParams.has("range")
              ? { range: url.searchParams.get("range") as AdminQuery["range"] }
              : {}),
          },
          actor,
        );
    return result.ok
      ? jsonSecure(result.data, {
          headers: { "cache-control": "private, no-store" },
        })
      : jsonSecure({ error: result.error }, { status: result.status });
  } catch {
    return jsonSecure(
      {
        error:
          "Launchpad admin service is unavailable; do not repeat an unknown operation with a new ID",
      },
      { status: 503 },
    );
  }
};

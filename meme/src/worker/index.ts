import { preview } from "../shared/fixtures";
import { authRequest } from "./auth";
import { roundsRequest } from "./rounds";
import { cycleRequest } from "./cycles";
import { holdingRequest } from "./holding";
import { settlementRequest } from "./settlement";
import { Problem, json as reply } from "./db";
import { securityHeaders } from "../shared/securityHeaders";
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      ...securityHeaders,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow",
    },
  });
export async function handleRequest(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (!["GET", "HEAD"].includes(request.method))
    return json(
      {
        error:
          "Participation and financial actions are disabled in this local preview",
      },
      405,
    );
  const response =
    path === "/health"
      ? json({ mode: "fixture", actionsEnabled: false })
      : path === "/api/meme/preview"
        ? json(preview)
        : json({ error: "Not found" }, 404);
  return request.method === "HEAD" ? new Response(null, response) : response;
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (env.LOCAL_PREVIEW_ONLY !== "true")
      return json({ error: "Local fixture preview is disabled" }, 404);
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(
        new URL(request.url).hostname,
      )
    )
      return json({ error: "Local application only" }, 404);
    if (
      env.LOCAL_PARTICIPATION_ENABLED === "true" &&
      new URL(request.url).pathname.startsWith("/api/")
    ) {
      try {
        const origin = request.headers.get("origin"),
          site = request.headers.get("sec-fetch-site");
        if (
          (origin && origin !== new URL(request.url).origin) ||
          (site && site !== "same-origin" && site !== "none")
        )
          return reply({ error: "Origin mismatch" }, 403);
        if (
          !["GET", "HEAD"].includes(request.method) &&
          request.headers.get("origin") !== new URL(request.url).origin
        )
          return reply({ error: "Origin mismatch" }, 403);
        return (
          (await authRequest(env.MEME_DB, request)) ??
          (await cycleRequest(env.MEME_DB, request)) ??
          (await holdingRequest(env.MEME_DB, request)) ??
          (await settlementRequest(env.MEME_DB, request)) ??
          (await roundsRequest(env.MEME_DB, request)) ??
          handleRequest(request)
        );
      } catch (error) {
        return reply(
          {
            error:
              error instanceof Problem
                ? error.message
                : "Request could not complete",
          },
          error instanceof Problem ? error.status : 400,
        );
      }
    }
    return handleRequest(request);
  },
} satisfies ExportedHandler<Env>;

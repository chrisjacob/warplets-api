import { preview } from "../shared/fixtures";
import { authRequest } from "./auth";
import { roundsRequest } from "./rounds";
import { cycleRequest } from "./cycles";
import { holdingRequest } from "./holding";
import { settlementRequest } from "./settlement";
import { operationsRequest, tick } from "./operations";
import { sourceRequest } from "./sources";
import { versionRequest } from "./evidenceVersions";
import { transactionsRequest } from "./transactions";
import { readPagesRequest } from "./readPages";
import { readinessRequest } from "./readiness";
import { marketRequest } from "./markets";
import { packetsRequest } from "./packets";
import { tradingRequest } from "./trading";
import { sharesRequest } from "./shares";
import { notificationsRequest } from "./notifications";
import { requireUnpaused } from "./controls";
import { Problem, json as reply } from "./db";
import { securityHeaders } from "../shared/securityHeaders";
import { qaRequest, qaResponse, qaTransportRequest } from "./qaAccess";
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
    try {
      if (request.headers.has("x-meme-qa-gateway"))
        request = qaTransportRequest(
          request,
          String(env.MEME_QA_ORIGIN),
          String(env.MEME_QA_GATEWAY_TOKEN),
        );
      else if (
        !["localhost", "127.0.0.1", "[::1]"].includes(
          new URL(request.url).hostname,
        )
      )
        return json({ error: "Local application only" }, 404);
    } catch (error) {
      return json(
        { error: "QA gateway unavailable" },
        error instanceof Problem ? error.status : 403,
      );
    }
    const requestUrl = new URL(request.url);
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
        const restricted =
          requestUrl.hostname !== "localhost" &&
          requestUrl.hostname !== "127.0.0.1" &&
          requestUrl.hostname !== "[::1]";
        if (restricted)
          await qaRequest(env.MEME_DB, request, String(env.MEME_QA_FIDS));
        if (
          ["GET", "HEAD"].includes(request.method) &&
          requestUrl.pathname.startsWith("/api/meme/") &&
          !requestUrl.pathname.startsWith("/api/meme/operator/")
        )
          await requireUnpaused(env.MEME_DB, "serving");
        const response =
          (await authRequest(env.MEME_DB, request)) ??
          (await readinessRequest(env.MEME_DB, request)) ??
          (await marketRequest(env.MEME_DB, request)) ??
          (await tradingRequest(env.MEME_DB, request)) ??
          (await sharesRequest(env.MEME_DB, request)) ??
          (await notificationsRequest(env.MEME_DB, request)) ??
          (await packetsRequest(env.MEME_DB, request)) ??
          (await readPagesRequest(env.MEME_DB, request)) ??
          (await transactionsRequest(env.MEME_DB, request)) ??
          (await operationsRequest(env.MEME_DB, request)) ??
          (await sourceRequest(env.MEME_DB, request, {
            helius: env.HELIUS_API_KEY ?? "",
            pyth: env.PYTH_API_KEY ?? "",
          })) ??
          (await versionRequest(env.MEME_DB, request)) ??
          (await cycleRequest(env.MEME_DB, request)) ??
          (await holdingRequest(env.MEME_DB, request)) ??
          (await settlementRequest(env.MEME_DB, request)) ??
          (await roundsRequest(env.MEME_DB, request)) ??
          handleRequest(request);
        return restricted
          ? qaResponse(
              env.MEME_DB,
              request,
              await response,
              String(env.MEME_QA_FIDS),
            )
          : response;
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
  async scheduled(_event, env): Promise<void> {
    if (
      env.LOCAL_PREVIEW_ONLY === "true" &&
      String(env.LOCAL_OPERATIONS_ENABLED) === "true"
    )
      await tick(env.MEME_DB);
  },
} satisfies ExportedHandler<Env>;

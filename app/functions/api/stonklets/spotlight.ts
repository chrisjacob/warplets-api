import { validNewsId } from "../../../shared/stonkletsSpotlight.js";
import { readSpotlight } from "../../_lib/stonkletSpotlight.js";
import { jsonSecure } from "../../_lib/security.js";

export const onRequestGet: PagesFunction<{ WARPLETS: D1Database }> = async ({ request, env }) => {
  const id = new URL(request.url).searchParams.get("news") ?? new URL(request.url).searchParams.get("thesis");
  if (id != null && !validNewsId(id)) return jsonSecure({ error: "invalid_thesis" }, { status: 400 });
  try {
    const validating = new URL(request.url).searchParams.get("validate") === "1";
    return jsonSecure(await readSpotlight(env.WARPLETS, id), { headers: { "cache-control": validating ? "private, no-store" : "public, max-age=30, s-maxage=30" } });
  } catch {
    return jsonSecure({ thesis: null, status: "unavailable", lastEvaluatedAt: null }, { status: 503 });
  }
};

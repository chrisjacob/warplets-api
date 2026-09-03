import { STONKLETS_BY_ID } from "../../../shared/stonkletsCatalog.js";

export const onRequestGet: PagesFunction = async ({ request, params, next }) => {
  const rawId = typeof params.id === "string" ? params.id : "";

  if (rawId.endsWith(".png")) {
    const id = rawId.slice(0, -4);
    if (!STONKLETS_BY_ID.has(id)) return new Response("Not found", { status: 404 });
    return next();
  }

  const entry = STONKLETS_BY_ID.get(rawId);
  if (!entry) return new Response("Not found", { status: 404 });

  return Response.redirect(new URL(`/stonklets/stocks/${entry.id}.png`, request.url), 308);
};

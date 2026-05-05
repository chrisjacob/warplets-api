interface Env {
  WARPLETS: D1Database;
}

const ALLOWED_PROTOCOLS = new Set(["https:", "http:"]);

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const requestUrl = new URL(context.request.url);
  const target = requestUrl.searchParams.get("url")?.trim();
  const sendId = requestUrl.searchParams.get("sendId")?.trim() ?? null;
  const email = requestUrl.searchParams.get("email")?.trim().toLowerCase() ?? null;

  if (!target) {
    return new Response("Missing url query parameter", { status: 400 });
  }

  let parsedTarget: URL;
  try {
    parsedTarget = new URL(target);
  } catch {
    return new Response("Invalid target URL", { status: 400 });
  }

  if (!ALLOWED_PROTOCOLS.has(parsedTarget.protocol)) {
    return new Response("Unsupported target URL", { status: 400 });
  }

  await context.env.WARPLETS.prepare(
    `INSERT INTO email_clicks (send_id, email, url, clicked_at) VALUES (?, ?, ?, ?)`
  )
    .bind(sendId, email, parsedTarget.toString(), new Date().toISOString())
    .run();

  return Response.redirect(parsedTarget.toString(), 302);
};

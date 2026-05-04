interface Env {
  WARPLETS: D1Database;
}

function htmlResponse(status: number, title: string, message: string): Response {
  return new Response(
    `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { margin:0; font-family: Arial, sans-serif; background:#040804; color:#d7ffd7; display:flex; min-height:100vh; align-items:center; justify-content:center; }
      .card { width:min(560px, 92vw); border:1px solid rgba(0,255,0,.35); background:rgba(0,0,0,.7); border-radius:16px; padding:24px; }
      h1 { margin:0 0 8px; color:#00FF00; font-size:24px; }
      p { margin:0; line-height:1.45; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${title}</h1>
      <p>${message}</p>
    </div>
  </body>
</html>`,
    {
      status,
      headers: { "content-type": "text/html; charset=utf-8" },
    }
  );
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const token = url.searchParams.get("token")?.trim();

  if (!token) {
    return htmlResponse(400, "Missing token", "The verification link is missing a token.");
  }

  const row = await context.env.WARPLETS.prepare(
    `SELECT id, verified FROM email_waitlist WHERE verify_token = ? LIMIT 1`
  )
    .bind(token)
    .first<{ id: number; verified: number }>();

  if (!row) {
    return htmlResponse(404, "Invalid link", "This verification link is invalid or has expired.");
  }

  if (row.verified === 1) {
    return htmlResponse(200, "Already verified", "Your email is already verified. You are all set.");
  }

  const now = new Date().toISOString();
  await context.env.WARPLETS.prepare(
    `UPDATE email_waitlist
     SET verified = 1, verified_at = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(now, now, row.id)
    .run();

  return htmlResponse(200, "Email verified", "Success. Your email is verified and your waitlist spot is confirmed.");
};

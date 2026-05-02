/**
 * POST /register-notification
 *
 * Called by the Mini App client when user grants notification permission.
 * Registers the notification token with Neynar and stores it in D1.
 */

interface Env {
  WARPLETS: D1Database;
  NEYNAR_API_KEY?: string;
}

interface RegisterRequest {
  fid: number;
  notificationToken: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const body = (await context.request.json()) as RegisterRequest;
    const { fid, notificationToken } = body;

    if (!fid || typeof fid !== "number" || !notificationToken) {
      return Response.json({ error: "Missing fid or notificationToken" }, { status: 400 });
    }

    const apiKey = context.env.NEYNAR_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "NEYNAR_API_KEY not configured" }, { status: 500 });
    }

    // Register with Neynar
    const neynarRegisterUrl = "https://api.neynar.com/v2/notifications/register";
    const neynarRegisterResp = await fetch(neynarRegisterUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        notificationToken,
        preferredProvider: "farcaster",
      }),
    });

    if (!neynarRegisterResp.ok) {
      const neynarError = await neynarRegisterResp.text();
      console.error("Neynar registration failed:", neynarError);
      return Response.json(
        {
          error: "Failed to register with Neynar",
          details: neynarError,
        },
        { status: 502 }
      );
    }

    // Store in D1
    await context.env.WARPLETS.prepare(
      `INSERT INTO miniapp_notification_tokens (fid, notification_url, notification_token, enabled)
       VALUES (?, ?, ?, 1)
       ON CONFLICT(fid) DO UPDATE SET
         notification_token = excluded.notification_token,
         enabled = 1,
         updated_at = datetime('now')`
    )
      .bind(fid, "neynar", notificationToken)
      .run();

    return Response.json(
      {
        ok: true,
        fid,
        message: "Notification registered successfully",
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Register notification error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
};

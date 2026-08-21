import type { DiscordVerificationAdmin } from "../../../../../bots/src/discordVerificationAdmin.js";
import { jsonSecure, requireAdminScope, type SecurityEnv } from "../../../_lib/security.js";

interface Env extends SecurityEnv {
  CHANNEL_BOTS_ADMIN?: Service<typeof DiscordVerificationAdmin>;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await requireAdminScope(context, { scope: "discord-verification:read" });
  if (!auth.ok) return auth.response;
  if (!context.env.CHANNEL_BOTS_ADMIN) {
    return jsonSecure({ error: "Discord verification admin service is not configured" }, { status: 503 });
  }
  try {
    const rows = await context.env.CHANNEL_BOTS_ADMIN.listDiscordVerifications();
    return jsonSecure({ rows });
  } catch (error) {
    console.error("Discord verification admin listing failed", error);
    return jsonSecure({ error: "Unable to load Discord verification associations" }, { status: 502 });
  }
};

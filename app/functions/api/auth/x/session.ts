import { getAppSession, type AppAuthEnv } from "../../../_lib/appAuth.js";
import { jsonSecure } from "../../../_lib/security.js";

interface Env extends AppAuthEnv {}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const session = await getAppSession(request, env);
  if (!session) return jsonSecure({ identity: null });
  const row = await env.WARPLETS.prepare(
    `SELECT provider_user_id, display_name, metadata_json, verified_at
       FROM external_identity_links
      WHERE provider = 'x' AND app_session_hash = ?
      ORDER BY verified_at DESC LIMIT 1`,
  ).bind(session.sessionHash).first<{ provider_user_id: string; display_name: string | null; metadata_json: string | null; verified_at: string }>();
  if (!row) return jsonSecure({ identity: null });
  let metadata: Record<string, unknown> = {};
  try { metadata = JSON.parse(row.metadata_json ?? "{}"); } catch { metadata = {}; }
  return jsonSecure({ identity: { id: row.provider_user_id, displayName: row.display_name, verifiedAt: row.verified_at, ...metadata } });
};

import { jsonSecure } from "../../_lib/security.js";

interface Env {
  VAPID_PUBLIC_KEY?: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  if (!publicKey) return jsonSecure({ error: "Web Push is not configured" }, { status: 503 });
  return jsonSecure({ publicKey }, { headers: { "cache-control": "public, max-age=3600" } });
};

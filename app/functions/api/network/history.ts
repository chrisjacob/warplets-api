import type { NetworkEnv } from '../../_lib/network/store';
import { jsonSecure } from '../../_lib/security';
import { cachedNetworkResponse } from '../../_lib/network/cache';
export const onRequestGet: PagesFunction<NetworkEnv> = async context => {
  if (context.env.NETWORK_ENABLED !== 'true') return jsonSecure({ error: 'Network is not enabled' }, { status: 404 });
  if (new URL(context.request.url).search) return jsonSecure({ error: 'History does not accept query parameters' }, { status: 400 });
  return cachedNetworkResponse(context, 'history', [], async () => {
  const result = await context.env.WARPLETS.prepare(`SELECT id,created_at AS createdAt,complete FROM network_snapshots n WHERE created_at=(SELECT MAX(created_at) FROM network_snapshots x WHERE x.day=n.day) ORDER BY created_at DESC LIMIT 366`).all();
  return jsonSecure({ snapshots: result.results });
  });
};

import { advanceNetwork } from '../../_lib/network/ingest';
import type { NetworkEnv } from '../../_lib/network/store';
import { jsonSecure, requireAdminScope, type SecurityEnv } from '../../_lib/security';
export const onRequestPost: PagesFunction<NetworkEnv & SecurityEnv> = async context => {
  const auth = await requireAdminScope(context, { scope: 'network:ingest' });
  if (!auth.ok) return auth.response;
  try { return jsonSecure(await advanceNetwork(context.env, { publish: true }), { headers: { 'cache-control': 'private, no-store' } }); }
  catch { return jsonSecure({ error: 'Network ingestion failed; previous snapshot retained' }, { status: 503 }); }
};

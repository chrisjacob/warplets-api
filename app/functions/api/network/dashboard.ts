import { decodeNetworkSnapshot } from '../../_lib/network/snapshot';
import { buildNetworkDashboard } from '../../_lib/network/aggregate';
import { parseNetworkFilters, validateNetworkParams } from '../../../shared/network/model';
import type { NetworkEnv } from '../../_lib/network/store';
import { jsonSecure } from '../../_lib/security';
import { cachedNetworkResponse } from '../../_lib/network/cache';
export const onRequestGet: PagesFunction<NetworkEnv> = async context => {
  if (context.env.NETWORK_ENABLED !== 'true') return jsonSecure({ error: 'Network is not enabled' }, { status: 404 });
  let filters;
  try { const params = new URL(context.request.url).searchParams; validateNetworkParams(params); filters = parseNetworkFilters(params); }
  catch (error) { return jsonSecure({ error: error instanceof Error ? error.message : 'Invalid filters' }, { status: 400 }); }
  return cachedNetworkResponse(context, 'dashboard', filters, async () => {
  const row = filters.snapshot === 'current'
    ? await context.env.WARPLETS.prepare('SELECT payload FROM network_snapshots ORDER BY created_at DESC LIMIT 1').first<{ payload: string }>()
    : await context.env.WARPLETS.prepare('SELECT payload FROM network_snapshots WHERE id=?').bind(filters.snapshot).first<{ payload: string }>();
  if (!row && filters.snapshot !== 'current') return jsonSecure({ error: 'Snapshot not found' }, { status: 404 });
  const snapshot = row ? await decodeNetworkSnapshot(row.payload) : null;
  if(filters.warplet==='holders'&&snapshot?.warplets?.status!=='ready')return jsonSecure({error:'Saved Warplets ownership is not available in this snapshot'}, {status:503});
  const body = buildNetworkDashboard(snapshot, filters);
  return jsonSecure(body);
  });
};

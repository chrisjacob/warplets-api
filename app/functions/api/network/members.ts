import { memberQuery, readNetworkMembers } from '../../_lib/network/members';
import type { NetworkEnv } from '../../_lib/network/store';
import { jsonSecure } from '../../_lib/security';
import { cachedNetworkResponse } from '../../_lib/network/cache';
export const onRequestGet: PagesFunction<NetworkEnv> = async context => {
  if (context.env.NETWORK_ENABLED !== 'true') return jsonSecure({ error: 'Network is not enabled' }, { status: 404 });
  const params = new URL(context.request.url).searchParams;
  let query;
  try { query = memberQuery(params); }
  catch (error) { return jsonSecure({ error: error instanceof Error ? error.message : 'Invalid member filters' }, { status: 400 }); }
  return cachedNetworkResponse(context, 'members', [query.from, query.values, query.after], async () => jsonSecure(await readNetworkMembers(context.env.WARPLETS, params)));
};

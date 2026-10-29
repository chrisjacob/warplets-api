import { isRetiredAppRoute } from '../shared/retiredApps';
import { applySecurityHeaders } from './_lib/security';
import { tenxAppEnabled, tenxReleaseSurface, type TenxReleaseEnv } from '../shared/tenxRelease';

export const onRequest: PagesFunction<TenxReleaseEnv> = async context => {
  const url = new URL(context.request.url);
  if (isRetiredAppRoute(url.hostname, url.pathname)) {
    return applySecurityHeaders(new Response('Not found', { status: 404 }));
  }
  const surface = tenxReleaseSurface(url.pathname);
  if (surface && !tenxAppEnabled(context.env.TENX_APP_ENABLED)) {
    // Navigation recovers at the thesis. APIs and mutation attempts never
    // redirect, forward, read storage or reach a downstream handler.
    const navigate = surface === 'page' && ['GET', 'HEAD'].includes(context.request.method);
    return applySecurityHeaders(new Response(navigate ? null : 'Not found', {
      status: navigate ? 302 : 404,
      headers: {
        ...(navigate ? { location: new URL('/', url).href } : {}),
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex, nofollow',
      },
    }));
  }
  return context.next();
};

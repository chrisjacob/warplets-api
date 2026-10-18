import { isRetiredAppRoute } from '../shared/retiredApps';
import { applySecurityHeaders } from './_lib/security';

export const onRequest: PagesFunction = async context => {
  const url = new URL(context.request.url);
  if (isRetiredAppRoute(url.hostname, url.pathname)) {
    return applySecurityHeaders(new Response('Not found', { status: 404 }));
  }
  return context.next();
};

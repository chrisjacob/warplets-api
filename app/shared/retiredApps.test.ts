import { expect, it } from 'vitest';
import { isRetiredAppRoute } from './retiredApps';
it('rejects retired pages and APIs without affecting shared social features', () => {
  for (const path of ['/social', '/social/post/abc', '/api/social/feed', '/api/admin/social']) expect(isRetiredAppRoute('localhost', path)).toBe(true);
  expect(isRetiredAppRoute('social-local.10x.meme', '/')).toBe(true);
  for (const path of ['/network', '/stonklets', '/api/stats/social', '/api/email/social-proof', '/api/warplet-social-profile']) expect(isRetiredAppRoute('localhost', path)).toBe(false);
});

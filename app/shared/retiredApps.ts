/** Keep retired surfaces from falling through to another application's shell. */
export function isRetiredAppRoute(hostname: string, pathname: string): boolean {
  const hosts = ['social.10x.meme', 'social-local.10x.meme', '10x.social', '10x-social.pages.dev'];
  return hosts.includes(hostname.toLowerCase()) || /^\/(?:social|api\/social|api\/admin\/social)(?:\/|$)/i.test(pathname);
}

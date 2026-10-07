import { SOCIAL_DESCRIPTION, SOCIAL_NAME } from "./social.js";
export function isSocialRoute(host: string, path: string) {
  return (
    ["social.10x.meme", "social-local.10x.meme"].includes(host) ||
    path === "/social" ||
    path.startsWith("/social/")
  );
}
export function socialManifest(host: string, association?: unknown) {
  const origin = `https://${host}`;
  return {
    ...(association ? { accountAssociation: association } : {}),
    miniapp: {
      version: "1",
      name: SOCIAL_NAME,
      homeUrl: origin,
      canonicalDomain: host,
      iconUrl: `${origin}/icon.png`,
      splashImageUrl: `${origin}/splash.png`,
      splashBackgroundColor: "#08180e",
      imageUrl: `${origin}/embed.png`,
      heroImageUrl: `${origin}/embed.png`,
      buttonTitle: "Open 10X Social",
      webhookUrl: `${origin}/webhook/social`,
      primaryCategory: "social",
      tags: ["crypto", "social", "farcaster", "10x"],
      subtitle: "One post. A real shot.",
      description:
        "One focused daily feed for crypto. Post, explore and earn attention.",
      tagline: "#1 Feed for Crypto",
      ogTitle: SOCIAL_NAME,
      ogDescription: SOCIAL_DESCRIPTION,
      ogImageUrl: `${origin}/embed.png`,
      noindex: host.includes("-local."),
    },
  };
}
function escape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
export function socialHtml(
  html: string,
  origin: string,
  path: string,
  title = SOCIAL_NAME,
  description = SOCIAL_DESCRIPTION,
  baseAppId?: string,
) {
  const url = `${origin}${path}`,
    image = `${origin}/embed.png`;
  const miniapp = {
    version: "1",
    imageUrl: image,
    button: {
      title: "Open 10X Social",
      action: {
        type: "launch_miniapp",
        name: SOCIAL_NAME,
        url,
        splashImageUrl: `${origin}/splash.png`,
        splashBackgroundColor: "#08180e",
      },
    },
  };
  html = html
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escape(title)}</title>`)
    .replace(
      /<meta\s+(?:name|property)=["'](?:description|og:[^"']+|twitter:[^"']+|fc:miniapp|fc:frame|base:app_id|application-name|apple-mobile-web-app-title)["'][^>]*>/gi,
      "",
    )
    .replace(
      /<link\s+rel=["'](?:canonical|manifest|icon|shortcut icon|apple-touch-icon)["'][^>]*>/gi,
      "",
    );
  const tags = [
    ["name", "description", description],
    ["property", "og:title", title],
    ["property", "og:description", description],
    ["property", "og:image", image],
    ["property", "og:url", url],
    ["property", "og:type", "website"],
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", title],
    ["name", "twitter:description", description],
    ["name", "twitter:image", image],
    ["name", "fc:miniapp", JSON.stringify(miniapp)],
    ["name", "fc:frame", JSON.stringify(miniapp)],
    ["name", "application-name", SOCIAL_NAME],
    ["name", "apple-mobile-web-app-title", SOCIAL_NAME],
  ];
  if (baseAppId) tags.push(["name", "base:app_id", baseAppId]);
  return html.replace(
    "</head>",
    `${tags.map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escape(value!)}"/>`).join("\n")}<link rel="canonical" href="${escape(url)}"/><link rel="manifest" href="/manifest-social.webmanifest"/><link rel="icon" type="image/png" href="/favicon-10x-v2.png"/><link rel="apple-touch-icon" href="/icon.png"/></head>`,
  );
}

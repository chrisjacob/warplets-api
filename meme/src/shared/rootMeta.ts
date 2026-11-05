import { escapeHtml } from "./shareCards";
/** Build/dev metadata only; this does not register an app, publish association or relax framing policy. */
export function rootMeta(origin?: string) {
  const title = "10X.meme · One launch. Or skip.",
    description = "Vote for an OG. Follow the launch. Claim rewards.";
  const tag = (property: string, content: string) =>
    `<meta property="${property}" content="${escapeHtml(content)}">`;
  let html =
    tag("og:title", title) +
    tag("og:description", description) +
    tag("og:type", "website") +
    '<meta name="twitter:card" content="summary_large_image">';
  if (!origin) return html;
  const url = new URL(origin);
  if (
    url.origin !== origin ||
    url.username ||
    url.password ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  )
    throw Error("Metadata needs an exact HTTPS origin or loopback origin");
  html +=
    tag("og:url", origin + "/") +
    tag("og:image", origin + "/social-og.png") +
    tag("og:image:width", "1200") +
    tag("og:image:height", "630");
  const action = {
      type: "launch_miniapp",
      name: "10X.meme",
      url: origin + "/",
      splashImageUrl: origin + "/icon.png",
      splashBackgroundColor: "#101512",
    },
    embed = {
      version: "1",
      imageUrl: origin + "/social-mini.png",
      button: { title: "Open 10X", action },
    };
  html += `<meta name="fc:miniapp" content="${escapeHtml(JSON.stringify(embed))}"><meta name="fc:frame" content="${escapeHtml(JSON.stringify({ ...embed, button: { ...embed.button, action: { ...action, type: "launch_frame" } } }))}">`;
  return html;
}

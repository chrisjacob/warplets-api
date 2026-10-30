export type CardKind = "candidate" | "launch" | "performance" | "rank" | "pnl";
export interface ShareCard {
  version: 1;
  id: string;
  kind: CardKind;
  subject: string;
  window: "24h" | "30d" | "all";
  fid: number | null;
  title: string;
  lines: string[];
  asOf: number;
  mode: "observed" | "simulated";
  sourceHash: string;
  targetPath: string;
}
export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function cardPage(card: ShareCard, origin: string) {
  const base = new URL(origin);
  if (
    base.origin !== origin ||
    base.username ||
    base.password ||
    !["https:", "http:"].includes(base.protocol)
  )
    throw Error("Exact configured origin required");
  const url = origin + "/api/meme/share/" + encodeURIComponent(card.id),
    target = new URL(card.targetPath, origin);
  if (target.origin !== origin) throw Error("Share target must stay in app");
  const image = url + "/mini.png",
    og = url + "/og.png";
  const embed = {
    version: "1",
    imageUrl: image,
    button: {
      title: "Open 10X",
      action: { type: "launch_miniapp", url: target.href, name: "10X.meme" },
    },
  };
  const meta = (name: string, content: string) =>
    `<meta property="${name}" content="${escapeHtml(content)}">`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(card.title)} · 10X.meme</title>${meta("og:title", card.title)}${meta("og:description", card.lines.join(" · "))}${meta("og:type", "website")}${meta("og:url", url)}${meta("og:image", og)}${meta("og:image:width", "1200")}${meta("og:image:height", "630")}<meta name="twitter:card" content="summary_large_image"><meta name="fc:miniapp" content="${escapeHtml(JSON.stringify(embed))}"><meta name="fc:frame" content="${escapeHtml(JSON.stringify({ ...embed, button: { ...embed.button, action: { ...embed.button.action, type: "launch_frame" } } }))}"><link rel="canonical" href="${escapeHtml(url)}"></head><body><h1>${escapeHtml(card.title)}</h1>${card.lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("")}<p>${card.mode === "simulated" ? "Simulated data · " : ""}${new Date(card.asOf).toISOString()}</p><a href="${escapeHtml(target.href)}">Open 10X.meme</a></body></html>`;
}

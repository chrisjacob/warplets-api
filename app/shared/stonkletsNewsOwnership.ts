import { STONKLETS_CATALOG } from "./stonkletsCatalog";

const aliases: Record<string,string[]> = {
 "spacex":["SpaceX","Starlink"],
 "alphabet":["Google","Alphabet","Gemini"],"amazon":["Amazon","AWS"],"nvidia":["NVIDIA","GeForce"],"microsoft":["Microsoft","Copilot"],"meta":["Meta","Meta Platforms","Facebook","Instagram"],"bitmine":["BitMine","BitMine Immersion Technologies"],"circle":["Circle Internet","Circle (CRCL)","Circle's"],"coherent":["Coherent Corp","Coherent Corporation","Coherent's"],"amd":["AMD","Advanced Micro Devices"],"strategy":["MicroStrategy","Strategy (MSTR)"],"trump-media":["Trump Media","Truth Social"],"tether-gold":["Tether Gold","XAUT"],"spy":["SPDR S&P 500"],"invesco-qqq":["Invesco QQQ"],"direxion-soxs":["SOXS","Direxion Daily Semiconductor Bear"],"direxion-soxl":["SOXL","Direxion Daily Semiconductor Bull"],"proshares-sqqq":["SQQQ","ProShares UltraPro Short QQQ"],"ishares-korea":["iShares MSCI South Korea"],"usa-rare-earth":["USA Rare Earth"],"super-micro":["Super Micro","Supermicro"],"ast-spacemobile":["AST SpaceMobile"]
};

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const NEWS_COMPANY_IDENTITIES = STONKLETS_CATALOG.map(entry => ({
  pairId: entry.id, aliases: aliases[entry.id] ?? [entry.stock.name],
}));

/** Choose globally so a stock-specific discovery feed cannot claim a rival's news.
 * Action subjects outrank comparison mentions; ambiguous ties use headline order.
 */
export function primaryNewsCompany(title: string): string | undefined {
  const matches = NEWS_COMPANY_IDENTITIES.flatMap(identity => {
    const mentions = identity.aliases.flatMap(alias => {
      const match = new RegExp(`\\b${escape(alias)}(?:\\b|$)`, "i").exec(title);
      if (!match) return [];
      const following = title.slice(match.index + match[0].length);
      const action = /^\s*(?:['\u2019]s\s+)?(?:launch(?:es|ed)?|lines? up|unveils?|introduces?|wins?|secures?|expands?|reports?|announces?|partners?|signs?|grows?|surges?|gains?|lands?|rolls? out)\b/i.test(following);
      const adverse = /^\s+(?:faces?|trails?|loses?|falls?|warns?|cuts?)\b/i.test(following);
      return [{ pairId: identity.pairId, index: match.index, score: action ? 2 : adverse ? -1 : 0 }];
    });
    return mentions;
  });
  return matches.sort((a, b) => b.score - a.score || a.index - b.index || a.pairId.localeCompare(b.pairId))[0]?.pairId;
}

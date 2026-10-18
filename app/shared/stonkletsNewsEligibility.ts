import { newsHistoryCutoff } from "./stonkletsNewsDates";
import type { ThesisSource } from "./stonkletsSpotlight";
import { positiveNews } from "./stonkletsTrendingNews";
export function qualifyingNarrative(source: ThesisSource, now: number): boolean {
  const age=now-Date.parse(source.publishedAt);
  if (!Number.isFinite(age)||age<0||Date.parse(source.publishedAt)<newsHistoryCutoff(now)) return false;
  if (/\b(?:best stocks?|stocks? to (?:buy|watch)|better buy|price target|upside|undervalued|overvalued|should you|why .+ stock|face-off|prediction|forecast|analyst|says .+sachs|mixed|reportedly|sources say|reportedly)\b|\?/.test(source.title.toLowerCase())) return false;
  if (/\b(?:valuation|market returns|facts worth knowing|strategic business report|market research|projected|seeks to|looks to|plans to raise)\b/i.test(source.title)) return false;
  // Syndicated RSS supplies short excerpts, not a full earnings/valuation review.
  // Publish concrete business events; leave financial-results interpretations for editorial review.
  if (source.publisher === "Yahoo Finance" && !/\b(?:launch(?:es|ed)?|introduc(?:es|ed|ing)|unveil(?:s|ed)?|approv(?:al|ed|es)|partner(?:s|ship)?|agreement|contract|deploy(?:s|ed)?|acquir(?:es|ed)|production|expands?)\b/i.test(source.title)) return false;
  if (/\b(?:rumou?r|speculation|could|might|alleged|sponsored|opinion|job cuts|revised guidance)\b/i.test(source.title)) return false;
  if (/\b(?:plung\w*|slump\w*|drop\w*|fines?|penalt\w*|fraud|probe|ban(?:s|ned)?|halt\w*|shortfall|downgrade\w*|layoffs?|despite|however|but|concerns?)\b/i.test(`${source.title} ${source.excerpt ?? ""}`)) return false;
  // Reuse adverse/neutral checks with the broader news horizon, not momentum eligibility.
  const current={...source,publishedAt:new Date(now).toISOString()};
  if(positiveNews(current,now)) return true;
  const text=`${source.title} ${source.excerpt??""}`;
  if(/\b(?:loss\w*|declin\w*|fell|fall\w*|warn\w*|recall|lawsuit|miss\w*|delay\w*|cuts?|risk\w*|not)\b/i.test(text)) return false;
  return /\b(?:revenue|sales|adoption|orders|subscribers|online retail|online shopping|e-commerce)\b.*\b(?:grew|grow\w*|increas\w*|rose|rises?|record)\b/i.test(source.title);
}

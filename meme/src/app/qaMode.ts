/** Tiny dev switch; the data, simulator and control UI live outside production builds. */
export const qaEnabled =
  typeof window !== "undefined" &&
  import.meta.env?.DEV === true &&
  location.hostname === "127.0.0.1" &&
  new URLSearchParams(location.search).get("qa") === "seeded";
export interface QAPerson {
  fid: number;
  name: string;
  initials: string;
  wallet: string;
  base: string;
  level: number;
}
export interface QAContext {
  mode: "simulated";
  generation: string;
  clock: number;
  paused: true;
  persona: string;
  scenario: string;
  person: QAPerson | null;
  people: QAPerson[];
  latestMarket: string | null;
}
export let qaContext: QAContext | null = null;
export function setQAContext(value: QAContext) {
  if (qaEnabled) qaContext = value;
}
export function qaPath(path: string) {
  if (!qaEnabled) return path;
  const url = new URL(path, location.origin);
  if (url.origin !== location.origin || !url.pathname.startsWith("/api/"))
    throw Error("Local QA API path required");
  url.pathname = "/__qa" + url.pathname;
  url.searchParams.set(
    "persona",
    new URLSearchParams(location.search).get("qaPersona") ?? "participant",
  );
  return url.pathname + url.search;
}
export function qaName(fid: number) {
  return qaEnabled
    ? (qaContext?.people.find((p) => p.fid === fid)?.name ?? "Demo trader")
    : "FID " + fid;
}
export function qaControlPath(path: string) {
  const url = new URL("/__qa/" + path, location.origin);
  url.searchParams.set(
    "persona",
    new URLSearchParams(location.search).get("qaPersona") ?? "participant",
  );
  return url.pathname + url.search;
}

import { afterEach, describe, expect, it, vi } from "vitest";
import { SCENARIO_PAIRS, scenarioPairings, scenarioPairAt, scenarioProgress, preloadScenarioImages } from "./stonkletsScenario";

afterEach(() => vi.unstubAllGlobals());
describe("onboarding scenario rotation", () => {
  it("keeps a valid pair when the first animation timestamp precedes its start", () => {
    expect(scenarioProgress(-.5, 15000)).toBe(0);
    expect(scenarioPairAt(SCENARIO_PAIRS, -.001)).toBe(SCENARIO_PAIRS[0]);
    for (const progress of [0, .1, .5, .999, 1, 2, NaN]) {
      expect(scenarioPairAt(SCENARIO_PAIRS, progress)?.stock).toBeDefined();
    }
    expect(scenarioPairAt(SCENARIO_PAIRS, 1)).toBe(SCENARIO_PAIRS.at(-1));
  });
  it("skips missing catalog entries and tolerates an empty catalog", () => {
    const pairs = scenarioPairings([SCENARIO_PAIRS[0]!]);
    expect(pairs).toHaveLength(1);
    expect(scenarioPairAt(pairs, 1)).toBe(pairs[0]);
    expect(scenarioPairAt(scenarioPairings([]), 0)).toBeUndefined();
  });
  it("preloads both sides once, without rejecting failed image requests", async () => {
    const images: Array<{ onload: (() => void) | null; onerror: (() => void) | null; src: string }> = [];
    vi.stubGlobal("Image", class {
      onload = null; onerror = null; src = "";
      constructor() { images.push(this); }
    });
    const pending = preloadScenarioImages();
    const again = preloadScenarioImages();
    const sources = new Set(SCENARIO_PAIRS.flatMap((pair) => [pair.stock.logo, pair.stonklet.image]));
    sources.add("/stonklets/Street_Fighter_VS_logo.png");
    expect(images.map((image) => image.src).sort()).toEqual([...sources].sort());
    images.forEach((image, index) => index === 0 ? image.onerror?.() : image.onload?.());
    await expect(pending).resolves.toHaveLength(sources.size);
    await again;
    const retry = preloadScenarioImages();
    expect(images).toHaveLength(sources.size + 1);
    images.at(-1)!.onload?.();
    await retry;
  });
});

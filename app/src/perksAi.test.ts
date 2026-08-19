import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PERKS_DEFINITIONS } from "./perksMockData";

describe("AI perk tool badges", () => {
  it("provides a real local logo and builder or creator benefit for every product", () => {
    const rows = PERKS_DEFINITIONS.ai.explorer.rows;
    const badges = rows.flatMap((row) => row.toolBadges ?? []);

    expect(badges).toHaveLength(16);
    expect(new Set(badges.map((badge) => badge.name)).size).toBe(16);
    expect(badges.find((badge) => badge.name === "Midjourney")?.logoSrc).toBe("/perks/ai-tools/midjourney-sailboat.png");
    expect(badges.find((badge) => badge.name === "Adobe Firefly")?.logoSrc).toBe("/perks/ai-tools/adobe-firefly-official.png");
    expect(badges.filter((badge) => badge.invertLogo).map((badge) => badge.name)).toEqual([
      "Midjourney",
      "Runway",
      "Venice.ai",
      "Proton Lumo",
    ]);
    for (const badge of badges) {
      expect(badge.logoSrc).toMatch(/^\/perks\/ai-tools\/[a-z0-9-]+\.(png|svg)$/);
      expect(existsSync(resolve(process.cwd(), "public", badge.logoSrc.slice(1)))).toBe(true);
      expect(badge.tagline.length).toBeGreaterThan(20);
    }
  });

  it("keeps four product badges in every compute category", () => {
    for (const row of PERKS_DEFINITIONS.ai.explorer.rows) {
      expect(row.toolBadges).toHaveLength(4);
    }
  });
});

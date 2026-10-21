import { mkdtemp, rmdir, unlink, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { sourceReviewCommand, readSourceReviewFile } from "../../scripts/discovery-source-review";
import { syntheticSourcePilotInputs } from "./source-pilot-fixtures";
import { SOURCE_PILOT_LIMITS } from "./source-pilot-model";

describe("offline source-review CLI", () => {
  it("runs plans and labelled examples without network, credentials or a database", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("forbidden"));
    try {
      expect(await sourceReviewCommand([])).toMatchObject({ live_collection_enabled: false, provider_requests: 0 });
      expect(await sourceReviewCommand(["demo"])).toMatchObject({ synthetic: true, live_collection_enabled: false });
      expect(network).not.toHaveBeenCalled();
      await expect(sourceReviewCommand(["activate"])).rejects.toThrow("source_pilot_usage");
      await expect(sourceReviewCommand(["demo", "extra"])).rejects.toThrow("source_pilot_usage");
    } finally { network.mockRestore(); }
  });
  it("reviews, freezes and replays explicit files, rejects overwrite and bounds reads", async () => {
    const dir = await mkdtemp(join(tmpdir(), "10x-source-pilot-")), inputPath = join(dir, "input.json"), recordPath = join(dir, "record.json"), hugePath = join(dir, "huge.json");
    try {
      const input = syntheticSourcePilotInputs()[0]!;
      input.response = (input.response as Record<string, unknown>[]).map(row => ({ ...row, ignored_secret: "not-a-real-credential" }));
      await writeFile(inputPath, JSON.stringify(input), { flag: "wx" });
      const review = await sourceReviewCommand(["review", inputPath]);
      expect(JSON.stringify(review)).not.toContain("not-a-real-credential");
      expect(await sourceReviewCommand(["plan", inputPath])).toMatchObject({ proposed_http_requests: 1 });
      await sourceReviewCommand(["freeze", inputPath, recordPath]);
      expect(await sourceReviewCommand(["replay", recordPath])).toMatchObject({ replay: "verified", source_authenticity: "unverified", provider_requests: 0 });
      await expect(sourceReviewCommand(["freeze", inputPath, recordPath])).rejects.toThrow();
      await expect(sourceReviewCommand(["freeze", inputPath, inputPath])).rejects.toThrow("source_pilot_output_conflict");
      expect(JSON.parse(await readFile(inputPath, "utf8"))).toEqual(input);
      await writeFile(hugePath, "x".repeat(SOURCE_PILOT_LIMITS.input_bytes + 1), { flag: "wx" });
      await expect(readSourceReviewFile(hugePath, SOURCE_PILOT_LIMITS.input_bytes)).rejects.toThrow("source_pilot_size_limit");
      await writeFile(hugePath, "malformed {json");
      await expect(readSourceReviewFile(hugePath, SOURCE_PILOT_LIMITS.input_bytes)).rejects.toThrow("source_pilot_invalid_json");
    } finally {
      // Only exact files created by this test; no recursive deletion.
      for (const file of [inputPath, recordPath, hugePath]) await unlink(file).catch(() => undefined);
      await rmdir(dir);
    }
  });
});

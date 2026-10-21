import { open, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SourceError } from "../discovery/src/rpc";
import { SOURCE_PILOT_LIMITS } from "../discovery/src/source-pilot-model";
import { freezeSourcePilot, replaySourcePilot, sourcePilotError, sourcePilotPlan } from "../discovery/src/source-pilot";
import { syntheticSourcePilotInputs } from "../discovery/src/source-pilot-fixtures";
import { reviewSourceActivity, replaySourceActivity } from "../discovery/src/source-pilot-activity";
import { syntheticSourceActivityInput } from "../discovery/src/source-pilot-activity-fixtures";

export async function readSourceReviewFile(file: string, byteLimit: number): Promise<unknown> {
  const handle = await open(file, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > byteLimit) throw new SourceError("source_pilot_size_limit");
    // Read at most limit + 1 even if the file grows after stat().
    const buffer = Buffer.alloc(byteLimit + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const read = await handle.read(buffer, bytes, buffer.length - bytes, null);
      if (!read.bytesRead) break;
      bytes += read.bytesRead;
    }
    if (bytes > byteLimit) throw new SourceError("source_pilot_size_limit");
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytes))); }
    catch { throw new SourceError("source_pilot_invalid_json"); }
  } finally { await handle.close(); }
}
export async function sourceReviewCommand(args: string[]) {
  const [action = "plan", file, output, ...rest] = args;
  if (rest.length) throw new SourceError("source_pilot_usage");
  if (action === "compare-demo" && !file && !output) {
    const record = await reviewSourceActivity(syntheticSourceActivityInput());
    return { synthetic: true, live_collection_enabled: false, ...await replaySourceActivity(record) };
  }
  if ((action === "compare" && !output || action === "compare-freeze" && output) && file) {
    const record = await reviewSourceActivity(await readSourceReviewFile(file, SOURCE_PILOT_LIMITS.input_bytes));
    if (output) {
      if (resolve(file) === resolve(output)) throw new SourceError("source_pilot_output_conflict");
      await writeFile(output, JSON.stringify(record), { encoding: "utf8", flag: "wx" });
    }
    return { record_hash: record.record_hash, report: record.report };
  }
  if (action === "compare-replay" && file && !output)
    return replaySourceActivity(await readSourceReviewFile(file, SOURCE_PILOT_LIMITS.record_bytes));
  if (action === "plan" && !output) {
    if (!file) return sourcePilotPlan();
    const input = await freezeSourcePilot(await readSourceReviewFile(file, SOURCE_PILOT_LIMITS.input_bytes));
    return sourcePilotPlan(input.inputs.request);
  }
  if (action === "demo" && !file && !output) return { synthetic: true, live_collection_enabled: false, examples: await Promise.all(syntheticSourcePilotInputs().map(async input => {
    const record = await freezeSourcePilot(input);
    return { ...await replaySourcePilot(record), proposed_plan: sourcePilotPlan(input.request) };
  })) };
  if (action === "review" && file && !output) {
    const record = await freezeSourcePilot(await readSourceReviewFile(file, SOURCE_PILOT_LIMITS.input_bytes));
    return { record_hash: record.record_hash, report: record.report };
  }
  if (action === "freeze" && file && output) {
    const record = await freezeSourcePilot(await readSourceReviewFile(file, SOURCE_PILOT_LIMITS.input_bytes));
    // Explicit local export only; never overwrite the input or an existing file.
    if (resolve(file) === resolve(output)) throw new SourceError("source_pilot_output_conflict");
    await writeFile(output, JSON.stringify(record), { encoding: "utf8", flag: "wx" });
    return { record_hash: record.record_hash, report: record.report };
  }
  if (action === "replay" && file && !output) return replaySourcePilot(await readSourceReviewFile(file, SOURCE_PILOT_LIMITS.record_bytes));
  throw new SourceError("source_pilot_usage");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await sourceReviewCommand(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(JSON.stringify({ error: sourcePilotError(error) })); process.exitCode = 1; }
}

import { z } from "zod";
import { ElectionId, ElectionRecordSchema } from "../discovery/src/election-model";
import { replayElection } from "../discovery/src/elections";
import { boundedJson } from "../discovery/src/rpc";

const base = "http://127.0.0.1:8794/api/10x";
async function read(path: string) {
  const response = await fetch(`${base}/${path}`, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if (!response.ok) throw new Error(`Local election read failed: HTTP ${response.status}`);
  return boundedJson(response, 2_100_000);
}
const index = z.object({ data: z.object({ runs: z.array(z.object({ id: ElectionId })) }) }).parse(await read("elections"));
const ids = process.argv[2] ? [ElectionId.parse(process.argv[2])] : index.data.runs.slice(0, 3).map(r => r.id);
if (!ids.length) throw new Error("No local election snapshot yet; wait for maintenance or run an authenticated rehearsal");
const results = [];
for (const id of ids) {
  const detail = z.object({ data: z.object({ record: ElectionRecordSchema }) }).parse(await read(`elections/${id}`));
  const replay = await replayElection(detail.data.record);
  results.push({ id, outcome: detail.data.record.result.outcome, counts: detail.data.record.result.counts, input_hash: detail.data.record.input_hash, replay: replay.status });
}
console.log(JSON.stringify({ local_only: true, provider_requests: 0, snapshots: results }, null, 2));

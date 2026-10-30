/** Disposable test process. Never imported by the application or deployed. */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import worker from "../../../meme/src/worker/index";
import { testDb } from "../../../meme/src/worker/testDb";
import { sha } from "../../../meme/src/worker/db";
import { advance } from "../../../meme/src/worker/rounds";
import { seedReadArchive } from "../load/readArchive";
if (process.env.MEME_QA_HARNESS !== "local-disposable")
  throw Error("Explicit disposable harness flag required");
const origin = "http://127.0.0.1:5196";
let storage = testDb(),
  token = "",
  operator = "";
function environment() {
  return {
    MEME_DB: storage.db,
    LOCAL_PREVIEW_ONLY: "true",
    LOCAL_PARTICIPATION_ENABLED: "true",
    LOCAL_OPERATIONS_ENABLED: "false",
    HELIUS_API_KEY: "",
    PYTH_API_KEY: "",
  } as Env;
}
async function call(path: string, body?: unknown) {
  const response = await worker.fetch(
    new Request(origin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        origin,
        "content-type": "application/json",
        authorization: "Bearer " + operator,
        cookie: "meme_session=" + token,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    environment(),
  );
  const result = await response.json();
  if (!response.ok) throw Error(JSON.stringify(result));
  return result;
}
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const u = new URL(input instanceof Request ? input.url : String(input));
  if (!["127.0.0.1", "localhost"].includes(u.hostname))
    throw Error("External providers disabled in disposable browser regression");
  return nativeFetch(input, init);
};
const server = createServer(async (req, res) => {
  try {
    if (
      req.headers.host !== "127.0.0.1:8798" &&
      req.headers.host !== "127.0.0.1:5196"
    ) {
      res.writeHead(403).end();
      return;
    }
    const url = new URL(req.url!, origin);
    if (url.pathname === "/__qa/health") {
      res.setHeader("content-type", "application/json");
      res.end('{"mode":"disposable-test-harness"}');
      return;
    }
    if (url.pathname.startsWith("/__qa/")) {
      if (req.method !== "POST") {
        res.writeHead(405).end();
        return;
      }
      if (req.headers.origin && req.headers.origin !== origin) {
        res.writeHead(403).end();
        return;
      }
      if (url.pathname === "/__qa/reset") {
        storage.close();
        storage = testDb();
        token = randomUUID();
        operator = randomUUID();
        const now = Date.now();
        // External Farcaster assertion is substituted here only; wallet proofs use real cryptography.
        storage.raw
          .prepare("INSERT INTO meme_sessions VALUES(?,?,?,?,?)")
          .run(await sha(token), origin, 42, null, now + 86400000);
        storage.raw
          .prepare("INSERT INTO meme_operator_tokens VALUES(?,?,?)")
          .run(await sha(operator), "disposable browser fixture", now);
        await call("/api/meme/operator/rounds", {
          id: "browser-round",
          opensAt: now + 60000,
          closesAt: now + 3600000,
          attribute: "cast",
          simulated: true,
          candidates: [
            {
              id: "a",
              name: "Alpha",
              symbol: "ALPHA",
              ogMint: "11111111111111111111111111111111",
              evidence: "SIMULATED QA candidate",
            },
            {
              id: "b",
              name: "Beta",
              symbol: "BETA",
              ogMint: "11111111111111111111111111111112",
              evidence: "SIMULATED QA candidate",
            },
          ],
        });
        await call("/api/meme/operator/rounds/browser-round/freeze", {
          source: "warplets",
          mode: "simulated",
          sourceAt: now,
          checkpoint: "simulated-browser-empty",
          complete: true,
          ownership: [],
        });
        storage.raw
          .prepare(
            "UPDATE meme_rounds SET opens_at=?,closes_at=?,state='frozen' WHERE id='browser-round'",
          )
          .run(Date.now() - 1, Date.now() + 3600000);
        await advance(storage.db);
        res.setHeader(
          "set-cookie",
          `meme_session=${token}; Path=/; HttpOnly; SameSite=Strict`,
        );
      } else if (url.pathname === "/__qa/archive") {
        seedReadArchive(storage.raw);
      } else if (url.pathname === "/__qa/switch-account") {
        storage.raw
          .prepare("UPDATE meme_sessions SET fid=43 WHERE token_hash=?")
          .run(await sha(token));
      } else if (
        url.pathname === "/__qa/select" ||
        url.pathname === "/__qa/skip"
      ) {
        storage.raw
          .prepare(
            "UPDATE meme_rounds SET closes_at=?,state='closed' WHERE id='browser-round'",
          )
          .run(Date.now() - 1);
        await call(
          "/api/meme/operator/rounds/browser-round/outcome",
          url.pathname.endsWith("skip")
            ? { skip: true, reason: "SIMULATED operator skip" }
            : { candidateId: "b", reason: "SIMULATED reviewed selection" },
        );
      } else {
        res.writeHead(404).end();
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          mode: "simulated",
          externalFarcasterAssertion: "substituted",
        }),
      );
      return;
    }
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const c of req) {
      length += c.length;
      if (length > 65536) {
        res.writeHead(413).end();
        return;
      }
      chunks.push(c);
    }
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers))
      if (v) headers.set(k, Array.isArray(v) ? v.join(",") : v);
    const response = await worker.fetch(
      new Request(origin + req.url, {
        method: req.method,
        headers,
        ...(length ? { body: Buffer.concat(chunks) } : {}),
      }),
      environment(),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Fixture failure",
      }),
    );
  }
});
server.listen(8798, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () =>
    server.close(() => {
      storage.close();
      process.exit(0);
    }),
  );

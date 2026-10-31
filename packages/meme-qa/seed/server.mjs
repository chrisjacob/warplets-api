/** Local-only seed gateway; deliberately separate from the deployable Worker and normal D1. */
import { createServer } from "node:http";
import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
const port = Number(process.env.MEME_SEED_PORT ?? 8801),
  frontend = Number(process.env.MEME_SEED_FRONTEND_PORT ?? 5198),
  origin = "http://127.0.0.1:" + frontend;
if (
  !Number.isSafeInteger(port) ||
  port < 1024 ||
  port > 65535 ||
  !Number.isSafeInteger(frontend) ||
  frontend < 1024 ||
  frontend > 65535
)
  throw Error("Invalid loopback port");
const tempRoot = resolve(import.meta.dirname, "../../../.tmp"),
  directory = resolve(
    tempRoot,
    process.env.MEME_SEED_STORAGE ?? "meme-qa/seeded-preview",
  );
if (
  !directory.startsWith(tempRoot + "\\") &&
  !directory.startsWith(tempRoot + "/")
)
  throw Error("QA storage must stay inside repository .tmp");
mkdirSync(directory, { recursive: true });
const manifest = join(directory, "active.json"),
  nativeNow = Date.now;
let thread,
  ready,
  pending = new Map(),
  sequence = 0,
  transition = Promise.resolve();
function generation(scenario = "active", reset = false) {
  if (!["active", "release", "recovery", "empty"].includes(scenario))
    throw Error("Unknown QA scenario");
  const old = existsSync(manifest)
    ? JSON.parse(readFileSync(manifest, "utf8"))
    : null;
  const current =
    !reset && old?.scenario === scenario
      ? old
      : {
          generation: randomUUID(),
          scenario,
          asOf:
            Date.parse(
              new Intl.DateTimeFormat("en-CA", {
                timeZone: "Australia/Sydney",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
              }).format(new Date(nativeNow())) + "T00:00:00Z",
            ) + (scenario === "release" ? 19 * 3600000 + 40 * 60000 : 3600000),
        };
  if (!/^[a-f0-9-]{36}$/.test(current.generation))
    throw Error("Invalid QA generation");
  return current;
}
async function start(scenario = "active", reset = false) {
  if (thread) await thread.terminate();
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(Error("QA generation changed"));
  }
  pending.clear();
  const current = generation(scenario, reset);
  thread = new Worker(new URL("./runtime.mjs", import.meta.url), {
    workerData: {
      ...current,
      file: join(directory, current.generation + ".sqlite"),
      origin,
    },
    execArgv: [],
  });
  ready = new Promise((ok, fail) => {
    thread.once("error", fail);
    thread.on("message", (message) => {
      if (message.ready) {
        writeFileSync(manifest, JSON.stringify(current));
        ok(message.context);
      } else {
        const request = pending.get(message.id);
        if (request) {
          pending.delete(message.id);
          clearTimeout(request.timer);
          request.resolve(message);
        }
      }
    });
  });
  thread.on("error", () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(Error("QA backend unavailable"));
    }
    pending.clear();
  });
  return ready;
}
function call(input) {
  return new Promise((resolve, reject) => {
    const id = ++sequence,
      timer = setTimeout(
        () => {
          pending.delete(id);
          reject(Error("QA request timed out"));
        },
        ["/clock", "/admin/commands"].includes(
          new URL(input.path, origin).pathname,
        )
          ? 90000
          : 30000,
      );
    pending.set(id, { resolve, reject, timer });
    thread.postMessage({ ...input, id });
  });
}
const boot = start(
  existsSync(manifest)
    ? JSON.parse(readFileSync(manifest, "utf8")).scenario
    : "active",
);
boot.catch((error) =>
  console.error("QA initialization failed:", error.message),
);
const server = createServer(async (req, res) => {
  try {
    if (
      ![new URL(origin).host, "127.0.0.1:" + port].includes(req.headers.host) ||
      (req.headers.origin && req.headers.origin !== origin) ||
      (req.headers["sec-fetch-site"] &&
        !["same-origin", "none"].includes(req.headers["sec-fetch-site"]))
    ) {
      res.writeHead(403).end();
      return;
    }
    const url = new URL(req.url, origin),
      path = url.pathname.replace(/^\/__qa/, ""),
      method = req.method;
    if (
      !["GET", "POST"].includes(method) ||
      !url.pathname.startsWith("/__qa/")
    ) {
      res.writeHead(404).end();
      return;
    }
    if (method === "POST" && req.headers.origin !== origin) {
      res.writeHead(403).end();
      return;
    }
    let bytes = 0,
      body = "";
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 1048576) {
        res.writeHead(413).end();
        return;
      }
      body += chunk.toString();
    }
    const parsed = body ? JSON.parse(body) : undefined;
    let session = (req.headers.cookie ?? "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("meme_qa_session="))
      ?.slice(16);
    if (!session || !/^[a-f0-9-]{36}$/.test(session)) {
      session = randomUUID();
      res.setHeader(
        "set-cookie",
        `meme_qa_session=${session}; Path=/__qa; HttpOnly; SameSite=Strict`,
      );
    }
    let result;
    if (path === "/reset" && method === "POST") {
      transition = transition
        .catch(() => {})
        .then(() => start(parsed?.scenario ?? "active", true));
      await transition;
      result = {
        status: 200,
        headers: [["content-type", "application/json"]],
        bytes: Buffer.from('{"reset":true}'),
      };
    } else {
      await transition;
      await ready;
      result = await call({
        path: path + url.search,
        method,
        body: parsed,
        session,
        expectedFid: req.headers["x-meme-viewer-fid"],
        persona: url.searchParams.get("persona") ?? "participant",
      });
    }
    res.writeHead(result.status, {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      ...Object.fromEntries(result.headers),
    });
    res.end(Buffer.from(result.bytes));
  } catch (error) {
    res
      .writeHead(503, {
        "content-type": "application/json",
        "cache-control": "no-store",
      })
      .end(JSON.stringify({ error: error.message }));
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log("Isolated seeded QA listening on 127.0.0.1:" + port),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    server.close();
    thread?.terminate();
  });

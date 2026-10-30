import { test, expect } from "@playwright/test";
import { createServer as httpServer, request as httpRequest } from "node:http";
import { createServer as httpsServer } from "node:https";
import { connect } from "node:net";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep, basename, dirname } from "node:path";
import { createGateway, issueGrant } from "../src/gateway.mjs";

// Real TLS and native redirects through a loopback-only CONNECT proxy. No route
// interception, forged browser Origin, public account or external network access.
test("native access form reproduces null Origin under no-referrer and succeeds with same-origin policy", async ({
  browser,
}) => {
  const dir = mkdtempSync(join(tmpdir(), "meme-form-"));
  const hostname = "gateway-form.trycloudflare.com",
    origin = "https://" + hostname;
  const invitation = issueGrant(42),
    sockets = new Set();
  let legacyPolicy = true,
    context;
  const origins = [],
    statuses = [];
  const gateway = createGateway(
    {
      origin,
      worker: "http://127.0.0.1:1",
      staticDirectory: dir,
      grants: [invitation.grant],
      upstreamToken: "t".repeat(43),
    },
    {
      fetcher: async () => {
        throw Error("Form regression must not call an upstream service");
      },
    },
  );
  let tls, proxy;
  const track = (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  };
  try {
    writeFileSync(
      join(dir, "index.html"),
      '<!doctype html><title>QA fixture</title><h1>QA ready</h1><img src="/base.webp" alt="Base"><img src="/farcaster.webp" alt="Farcaster"><img src="/trust.webp" alt="Wallets">',
    );
    for (const name of ["base", "farcaster", "trust"])
      writeFileSync(
        join(dir, name + ".webp"),
        readFileSync(
          new URL("../../../meme/public/" + name + ".webp", import.meta.url),
        ),
      );
    let openssl = "openssl";
    if (process.platform === "win32") {
      const git = execFileSync("where.exe", ["git"], {
        encoding: "utf8",
        windowsHide: true,
      })
        .trim()
        .split(/\r?\n/)[0];
      openssl = resolve(dirname(git), "../usr/bin/openssl.exe");
    }
    execFileSync(
      openssl,
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-sha256",
        "-nodes",
        "-keyout",
        join(dir, "key.pem"),
        "-out",
        join(dir, "cert.pem"),
        "-days",
        "1",
        "-subj",
        "/CN=" + hostname,
        "-addext",
        "subjectAltName=DNS:" + hostname,
      ],
      { windowsHide: true, stdio: "ignore" },
    );
    await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
    tls = httpsServer(
      {
        key: readFileSync(join(dir, "key.pem")),
        cert: readFileSync(join(dir, "cert.pem")),
      },
      (req, res) => {
        if (req.url === "/qa/access") origins.push(req.headers.origin ?? null);
        const outgoing = httpRequest(
          {
            hostname: "127.0.0.1",
            port: gateway.address().port,
            path: req.url,
            method: req.method,
            headers: req.headers,
          },
          (incoming) => {
            if (req.url === "/qa/access") statuses.push(incoming.statusCode);
            const headers = { ...incoming.headers };
            if (legacyPolicy && incoming.statusCode === 401)
              headers["referrer-policy"] = "no-referrer";
            res.writeHead(incoming.statusCode, headers);
            incoming.pipe(res);
          },
        );
        outgoing.on("error", () => {
          res.writeHead(502);
          res.end();
        });
        req.pipe(outgoing);
      },
    );
    tls.on("connection", track);
    await new Promise((resolve) => tls.listen(0, "127.0.0.1", resolve));
    proxy = httpServer((_req, res) => {
      res.writeHead(403);
      res.end();
    });
    proxy.on("connection", track);
    proxy.on("connect", (req, client, head) => {
      if (req.url !== hostname + ":443") {
        client.destroy();
        return;
      }
      const upstream = connect(tls.address().port, "127.0.0.1", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      track(upstream);
      upstream.on("error", () => client.destroy());
      client.on("error", () => upstream.destroy());
      client.on("close", () => upstream.destroy());
    });
    await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 390, height: 844 },
      proxy: { server: "http://127.0.0.1:" + proxy.address().port },
    });
    const page = await context.newPage();
    await page.goto(origin);
    await page.getByLabel("Access code").fill(invitation.code);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.locator("body")).toHaveText("Origin mismatch");
    expect(origins).toEqual(["null"]);
    expect(statuses).toEqual([403]);
    legacyPolicy = false;
    await page.goto(origin);
    await page.getByLabel("Access code").fill(invitation.code);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "QA ready" })).toBeVisible();
    expect(origins).toEqual(["null", origin]);
    expect(statuses).toEqual([403, 303]);
    expect(page.url()).toBe(origin + "/");
    for (const name of ["Base", "Farcaster", "Wallets"])
      await expect
        .poll(() =>
          page
            .getByAltText(name, { exact: true })
            .evaluate((img) => img.complete && img.naturalWidth > 0),
        )
        .toBe(true);
    expect(
      (await context.cookies()).some(
        (c) => c.name === "__Host-meme_qa" && c.secure && c.httpOnly,
      ),
    ).toBe(true);
  } finally {
    await context?.close();
    for (const socket of sockets) socket.destroy();
    gateway.closeAllConnections();
    tls?.closeAllConnections();
    await Promise.all(
      [gateway, tls, proxy]
        .filter(Boolean)
        .map((server) => new Promise((resolve) => server.close(resolve))),
    );
    if (
      !resolve(dir).startsWith(resolve(tmpdir()) + sep) ||
      !basename(dir).startsWith("meme-form-")
    )
      throw Error("Unexpected fixture cleanup path");
    rmSync(dir, { recursive: true, force: true });
  }
});

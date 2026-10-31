/** Development-only entry, loaded only after a loopback + Vite DEV check. */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { boundedResponseJson } from "./client";
import {
  qaContext,
  setQAContext,
  qaControlPath,
  type QAContext,
} from "./qaMode";
import "./qaStyle.css";
export async function qaRequest(path: string, body?: unknown) {
  const response = await fetch(qaControlPath(path), {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    signal: AbortSignal.timeout(90000),
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const data = await boundedResponseJson(response);
  if (!response.ok) throw Error(data.error ?? "QA backend unavailable");
  return data;
}
export function QAToolbar() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function command(path: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      await qaRequest(path, body);
      location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "QA action failed");
      setBusy(false);
    }
  }
  return (
    <aside className="qa-toolbar" aria-label="Local QA controls">
      <div className="list-heading">
        <strong>QA simulation</strong>
        <a href="/__adminhidden/meme?qa=seeded">Admin ↗</a>
      </div>
      <details>
        <summary>QA controls · {qaContext?.person?.name ?? "Guest"}</summary>
        <div className="qa-controls">
          <label>
            Persona
            <select
              value={qaContext?.persona ?? "participant"}
              onChange={(e) => {
                const url = new URL(location.href);
                url.searchParams.set("qaPersona", e.target.value);
                for (const key of ["trader", "board"])
                  url.searchParams.delete(key);
                location.href = url.href;
              }}
            >
              <option value="participant">Nova Fox · participant</option>
              <option value="trader">Cedar Fox · trader</option>
              <option value="rewards">Solar Fox · rewards</option>
              <option value="nonholder">Amber Fox · no Warplet</option>
              <option value="guest">Guest</option>
            </select>
          </label>
          <label>
            Scenario
            <select
              disabled={busy}
              value={qaContext?.scenario ?? "active"}
              onChange={(e) => {
                if (confirm("Replace only the seeded QA dataset?"))
                  void command("reset", { scenario: e.target.value });
              }}
            >
              <option value="active">Active day</option>
              <option value="release">Launch / release window</option>
              <option value="recovery">Recovery</option>
              <option value="empty">Empty</option>
            </select>
          </label>
          <p className="fine">
            Demo clock paused ·{" "}
            {new Date(qaContext?.clock ?? 0).toLocaleString()}
          </p>
          <div className="qa-buttons">
            {[
              ["hour", "+1 hour"],
              ["boundary", "Next boundary"],
              ["day", "+1 day"],
            ].map(([step, label]) => (
              <button
                key={step}
                disabled={busy}
                onClick={() =>
                  void command("clock", {
                    step,
                    expectedClock: qaContext?.clock,
                  })
                }
              >
                {label}
              </button>
            ))}
          </div>
          <div className="qa-buttons">
            <button
              disabled={busy}
              onClick={() => {
                if (confirm("Reset only QA data and its simulated actions?"))
                  void command("reset", {
                    scenario: qaContext?.scenario ?? "active",
                  });
              }}
            >
              Reset QA data
            </button>
            <button
              onClick={() => {
                const url = new URL(location.href);
                for (const key of [
                  "qa",
                  "qaPersona",
                  "market",
                  "trader",
                  "board",
                ])
                  url.searchParams.delete(key);
                location.href = url.href;
              }}
            >
              Use normal local data
            </button>
          </div>
          <p className="fine">
            Invented people, prices and activity. No wallet prompts or real
            sends.
          </p>
        </div>
      </details>
      {busy && <p role="status">Preparing QA data…</p>}
      {error && <p role="alert">{error}</p>}
    </aside>
  );
}
export async function mountQA(element: HTMLElement) {
  const root = createRoot(element);
  root.render(
    <main className="shell">
      <h1>Preparing your QA world…</h1>
      <p>30 launches · 240 demo users. First setup takes a moment.</p>
    </main>,
  );
  try {
    setQAContext((await qaRequest("context")) as QAContext);
    root.render(
      <>
        <QAToolbar />
        <App />
      </>,
    );
  } catch (e) {
    root.render(
      <main className="shell">
        <h1>QA backend unavailable</h1>
        <p role="alert">
          {e instanceof Error ? e.message : "Could not load QA"}
        </p>
        <p>Start: pnpm --dir packages/meme-qa seed:serve</p>
        <button onClick={() => location.reload()}>Retry</button>
        <button
          onClick={() => {
            if (confirm("Reset only the seeded QA dataset?"))
              void qaRequest("reset", { scenario: "active" }).then(() =>
                location.reload(),
              );
          }}
        >
          Reset QA data
        </button>
        <a href="/">Normal local app</a>
      </main>,
    );
  }
}
